import { requireCareRole } from "@/lib/auth/require-care-role";
import { buildDailyAggregates } from "@/lib/early-warning/aggregates";
import { dateKey, WINDOW_DAYS } from "@/lib/early-warning/engine";
import { CARE_HOME_TZ, loadLiveData, parseSources, persistAlerts, runLiveEngine } from "@/lib/early-warning/server";

// ---------------------------------------------------------------------------
// POST /api/behavior-analysis
//
// The behaviour-analysis pipeline, now inside ElderLink instead of relying on
// an external script:
//   1. Load the last 28 days of care logs (as the signed-in staff user).
//   2. Rebuild the care-score columns of `daily_aggregates` for every
//      resident-day that has logs. Existing rows are updated in place, and
//      their simulated sensor columns (sleep, washroom, activity) are left
//      untouched. Missing rows are inserted.
//   3. Run the personal-baseline engine and add any new flags to
//      `behavior_alerts`, without duplicating alerts that are still open.
//
// ?sources=manual (default) | manual,sensor,demo: which entry_source values
// count as observations.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  const sources = parseSources(new URL(request.url));

  try {
    const data = await loadLiveData(auth.supabase);
    const sinceDate = dateKey(new Date(Date.now() - (WINDOW_DAYS - 1) * 86_400_000), CARE_HOME_TZ);

    // ---- 1. daily_aggregates -------------------------------------------
    const computed = buildDailyAggregates({
      residents: data.residents,
      logs: data.logs,
      timeZone: CARE_HOME_TZ,
      sinceDate,
      allowedSources: sources,
    });

    const { data: existing, error: exErr } = await auth.supabase
      .from("daily_aggregates")
      .select("id, resident_id, date, day_index")
      .gte("date", sinceDate);
    if (exErr) throw new Error(`Could not read daily_aggregates: ${exErr.message}`);

    const existingByKey = new Map(
      (existing ?? []).map((r) => [`${r.resident_id}|${String(r.date).slice(0, 10)}`, r])
    );
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown>[] = [];
    const inserts: Record<string, unknown>[] = [];

    // day_index: 1-based day number inside the 28-day window (oldest = 1).
    const windowStart = Date.parse(`${sinceDate}T00:00:00Z`);

    for (const row of computed) {
      const { log_count, ...cols } = row;
      void log_count;
      const prev = existingByKey.get(`${row.resident_id}|${row.date}`);
      const dayIndex = Math.round((Date.parse(`${row.date}T00:00:00Z`) - windowStart) / 86_400_000) + 1;
      if (prev) {
        updates.push({ id: prev.id, ...cols, day_index: prev.day_index ?? dayIndex, updated_at: nowIso });
      } else {
        inserts.push({ ...cols, day_index: dayIndex, updated_at: nowIso });
      }
    }

    // Updates: upsert on the primary key with only care-score columns in the
    // payload, so sensor columns on the existing rows are not touched.
    for (let i = 0; i < updates.length; i += 500) {
      const { error } = await auth.supabase
        .from("daily_aggregates")
        .upsert(updates.slice(i, i + 500), { onConflict: "id" });
      if (error) throw new Error(`Could not update daily_aggregates: ${error.message}`);
    }
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await auth.supabase.from("daily_aggregates").insert(inserts.slice(i, i + 500));
      if (error) throw new Error(`Could not insert daily_aggregates: ${error.message}`);
    }

    // ---- 2. behaviour alerts --------------------------------------------
    const report = runLiveEngine(data, sources);
    const alerts = await persistAlerts(auth.supabase, report);

    return Response.json({
      analysedAt: nowIso,
      sources,
      logsUsed: report.totals.logsUsed,
      logsExcluded: report.totals.logsExcluded,
      aggregatesUpdated: updates.length,
      aggregatesInserted: inserts.length,
      alertsInserted: alerts.inserted,
      alertsSkipped: alerts.skipped,
      residentsFlagged: report.totals.act + report.totals.watch,
      residentsLearning: report.totals.buildingBaseline,
      warnings: data.warnings,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Behaviour analysis failed." }, { status: 500 });
  }
}
