import { requireCareRole } from "@/lib/auth/require-care-role";
import { CARE_HOME_TZ, loadLiveData, runLiveEngine } from "@/lib/early-warning/server";
import { buildHandover, shiftFor, type ShiftLog } from "@/lib/handover/build";

// ---------------------------------------------------------------------------
// /api/handover
//
// GET  ?hours=N → builds a structured handover for the current shift (or the
//                 last N hours, 1–24) from care logs, falls, emergency and
//                 behaviour alerts, assistance requests and notes. Each line
//                 is taken from a database row; no AI is used.
// POST { note } → saves the (staff-edited) handover to handover_notes,
//                 tagged with the shift.
//
// Requires a signed-in admin/staff user; all queries run as that user (RLS).
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;

  const now = new Date();
  const { shift, start } = shiftFor(now, CARE_HOME_TZ);
  const hoursParam = Number(new URL(request.url).searchParams.get("hours"));
  const from =
    Number.isFinite(hoursParam) && hoursParam >= 1 && hoursParam <= 24
      ? new Date(now.getTime() - hoursParam * 3_600_000)
      : start;
  const fromIso = from.toISOString();
  const warnings: string[] = [];

  try {
    const live = await loadLiveData(supabase);
    warnings.push(...live.warnings);
    const report = runLiveEngine(live);

    const { data: logs, error: logErr } = await supabase
      .from("care_logs_demo")
      .select(
        "resident_id, created_at, meals, fluids, mood, medication, notes, pain_scale, pain_note, systolic, diastolic, heart_rate, temperature, entry_source"
      )
      .gte("created_at", fromIso)
      .order("created_at", { ascending: true })
      .limit(2000);
    if (logErr) throw new Error(`Could not load care logs: ${logErr.message}`);

    // Optional sources: a missing table or column only adds a warning.
    const optional = async <T,>(label: string, q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => {
      const { data, error } = await q;
      if (error) {
        warnings.push(`${label} unavailable (${error.message}).`);
        return [] as T[];
      }
      return data ?? [];
    };

    const [openFalls, emergencies, behaviour, assistance, notes, staffRow] = await Promise.all([
      optional<{ resident_id: string | null; status: string | null; triggered_at: string | null }>(
        "Fall alerts",
        supabase.from("fall_events").select("resident_id, status, triggered_at").in("status", ["unresolved", "active"])
      ),
      optional<Record<string, unknown>>(
        "Emergency alerts",
        supabase.from("emergency_alerts").select("*").gte("created_at", fromIso)
      ),
      optional<{ resident_id: string | null; resident_name: string | null; metric: string | null; severity: string | null; message: string | null }>(
        "Behaviour alerts",
        supabase
          .from("behavior_alerts")
          .select("resident_id, resident_name, metric, severity, message")
          .eq("resolved", false)
          .limit(200)
      ),
      optional<Record<string, unknown>>(
        "Assistance requests",
        supabase.from("assistance_requests").select("*").gte("created_at", fromIso)
      ),
      optional<{ note: string; created_at: string; shift: string | null }>(
        "Handover notes",
        supabase.from("handover_notes").select("note, created_at, shift").gte("created_at", fromIso).order("created_at")
      ),
      supabase.from("staff").select("full_name").eq("id", auth.userId).maybeSingle(),
    ]);

    const handover = buildHandover({
      shift,
      from: fromIso,
      to: now.toISOString(),
      residents: live.residents,
      logs: (logs ?? []) as ShiftLog[],
      earlyWarning: report.residents,
      openFalls,
      emergencies,
      openBehaviorAlerts: behaviour,
      assistance,
      notes,
      authorName: (staffRow.data as { full_name?: string | null } | null)?.full_name ?? null,
      timeZone: CARE_HOME_TZ,
    });

    return Response.json({ handover, warnings });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build handover." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { note?: unknown };
  const note = String(body.note ?? "").trim().slice(0, 8000);
  if (note.length < 5) return Response.json({ error: "Handover is empty." }, { status: 400 });

  const { shift } = shiftFor(new Date(), CARE_HOME_TZ);
  let { error } = await auth.supabase.from("handover_notes").insert({ note, shift });
  if (error && /shift/i.test(error.message)) {
    ({ error } = await auth.supabase.from("handover_notes").insert({ note }));
  }
  if (error) return Response.json({ error: `Could not save handover: ${error.message}` }, { status: 500 });
  return Response.json({ saved: true, shift });
}
