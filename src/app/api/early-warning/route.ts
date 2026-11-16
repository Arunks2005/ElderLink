import { requireCareRole } from "@/lib/auth/require-care-role";
import {
  runEarlyWarning,
  toBehaviorAlertRows,
  WINDOW_DAYS,
  type CareLogInput,
  type FamilyContactInput,
  type FamilyMessageInput,
  type ResidentInput,
} from "@/lib/early-warning/engine";

// ---------------------------------------------------------------------------
// /api/early-warning
//
// GET  → runs the Early Warning engine over LIVE data and returns the
//        care-rounds report.
// POST → re-runs the engine on the server and writes each flagged signal into
//        the existing `behavior_alerts` table (so it shows on the Behaviour
//        Alerts page). Unresolved alerts for the same resident and metric are
//        not duplicated. The client never sends alert contents. The server
//        recomputes them, so a caller cannot inject arbitrary alerts.
//
// Security: requires a signed-in admin or staff user, and queries run as that
// user (anon key + cookie), so row-level security still applies. No service
// role key is used.
// ---------------------------------------------------------------------------

const INACTIVE = new Set(["discharged", "deceased", "inactive", "archived"]);
const PAGE = 1000; // PostgREST default max rows per request

type Supa = Extract<Awaited<ReturnType<typeof requireCareRole>>, { ok: true }>["supabase"];

async function loadLiveData(supabase: Supa) {
  const warnings: string[] = [];
  const since = new Date(Date.now() - (WINDOW_DAYS + 1) * 86_400_000).toISOString();
  const msgSince = new Date(Date.now() - 60 * 86_400_000).toISOString();

  const { data: residentRows, error: resErr } = await supabase
    .from("residents")
    .select("id, full_name, room_number, status")
    .order("full_name");
  if (resErr) throw new Error(`Could not load residents: ${resErr.message}`);

  const residents: ResidentInput[] = (residentRows ?? [])
    .filter((r) => !INACTIVE.has(String(r.status ?? "").toLowerCase()))
    .map((r) => ({ id: r.id, full_name: r.full_name ?? "Resident", room_number: r.room_number ?? null }));

  const logs: CareLogInput[] = [];
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from("care_logs_demo")
      .select("resident_id, created_at, meals, fluids, mood, medication, pain_scale, heart_rate, temperature, entry_source")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Could not load care logs: ${error.message}`);
    logs.push(...((data ?? []) as CareLogInput[]));
    if (!data || data.length < PAGE) break;
  }

  const { data: contacts, error: cErr } = await supabase
    .from("family_contacts")
    .select("resident_id, full_name, relationship, phone, is_primary");
  if (cErr) warnings.push(`Family contacts unavailable (${cErr.message}). Connection signal limited.`);

  const { data: messages, error: mErr } = await supabase
    .from("family_messages")
    .select("resident_id, created_at, sender_role")
    .gte("created_at", msgSince);
  if (mErr) warnings.push(`Family messages unavailable (${mErr.message}). Days since contact unknown.`);

  return {
    residents,
    logs,
    familyContacts: (contacts ?? []) as FamilyContactInput[],
    familyMessages: (messages ?? []) as FamilyMessageInput[],
    warnings,
  };
}

function parseSources(url: URL): string[] {
  const raw = url.searchParams.get("sources");
  const allowed = new Set(["manual", "sensor", "demo"]);
  const list = (raw ?? "manual")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => allowed.has(s));
  return list.length ? list : ["manual"];
}

export async function GET(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  try {
    const sources = parseSources(new URL(request.url));
    const { warnings, ...data } = await loadLiveData(auth.supabase);
    const report = runEarlyWarning({ ...data, allowedSources: sources });
    return Response.json({ report, warnings, sources, role: auth.role });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Early warning failed." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  let residentIds: string[] | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { resident_ids?: unknown };
    if (Array.isArray(body.resident_ids)) {
      residentIds = body.resident_ids.filter((x): x is string => typeof x === "string").slice(0, 200);
    }
  } catch {
    /* empty body is fine */
  }

  try {
    const { warnings, ...data } = await loadLiveData(auth.supabase);
    void warnings;
    const report = runEarlyWarning(data);
    const targets = report.residents.filter(
      (r) => r.flaggedSignals.length > 0 && (!residentIds || residentIds.includes(r.resident_id))
    );
    if (targets.length === 0) return Response.json({ inserted: 0, skipped: 0 });

    const { data: open, error: openErr } = await auth.supabase
      .from("behavior_alerts")
      .select("resident_id, metric")
      .eq("resolved", false)
      .in("resident_id", targets.map((t) => t.resident_id));
    if (openErr) throw new Error(`Could not read behaviour alerts: ${openErr.message}`);

    const existing = new Set((open ?? []).map((a) => `${a.resident_id}:${a.metric}`));
    const rows = targets.flatMap(toBehaviorAlertRows);
    const fresh = rows.filter((r) => !existing.has(`${r.resident_id}:${r.metric}`));

    if (fresh.length) {
      const { error } = await auth.supabase.from("behavior_alerts").insert(fresh);
      if (error) throw new Error(`Could not save behaviour alerts: ${error.message}`);
    }
    return Response.json({ inserted: fresh.length, skipped: rows.length - fresh.length });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Saving alerts failed." }, { status: 500 });
  }
}
