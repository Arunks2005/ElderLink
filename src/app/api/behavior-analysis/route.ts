import { requireCareRole } from "@/lib/auth/require-care-role";
import { loadLiveData, parseSources, persistAlerts, runLiveEngine } from "@/lib/early-warning/server";

// ---------------------------------------------------------------------------
// POST /api/behavior-analysis
//
// The behaviour-analysis pipeline, run on demand:
//   1. Refresh `daily_aggregates` for the last 28 days. The database already
//      recomputes a resident-day on every care-log insert/update (trigger
//      care_logs_demo_after_write → recompute_daily_aggregate). This calls
//      the staff-only refresh_recent_aggregates() function so older logs are
//      covered too. The database stays the single source of truth for those
//      scores, so the app never writes daily_aggregates directly.
//   2. Run the personal-baseline Early Warning engine over the raw care logs
//      and add new flags to `behavior_alerts` (no duplicates of open alerts).
//
// ?sources=manual (default) | manual,sensor,demo: which entry_source values
// the engine counts as observations.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  const sources = parseSources(new URL(request.url));
  const warnings: string[] = [];

  try {
    // ---- 1. daily_aggregates (database function) ------------------------
    let aggregatesRefreshed: number | null = null;
    const { data: refreshed, error: refreshErr } = await auth.supabase.rpc("refresh_recent_aggregates", {
      p_days: 28,
    });
    if (refreshErr) {
      warnings.push(
        `Daily scores were not refreshed (${refreshErr.message}). New care logs still update them automatically.`
      );
    } else {
      aggregatesRefreshed = typeof refreshed === "number" ? refreshed : null;
    }

    // ---- 2. personal-baseline alerts ------------------------------------
    const data = await loadLiveData(auth.supabase);
    warnings.push(...data.warnings);
    const report = runLiveEngine(data, sources);
    const alerts = await persistAlerts(auth.supabase, report);

    return Response.json({
      analysedAt: new Date().toISOString(),
      sources,
      logsUsed: report.totals.logsUsed,
      logsExcluded: report.totals.logsExcluded,
      aggregatesRefreshed,
      alertsInserted: alerts.inserted,
      alertsSkipped: alerts.skipped,
      residentsFlagged: report.totals.act + report.totals.watch,
      residentsLearning: report.totals.buildingBaseline,
      warnings,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Behaviour analysis failed." }, { status: 500 });
  }
}
