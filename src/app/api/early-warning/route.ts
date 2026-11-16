import { requireCareRole } from "@/lib/auth/require-care-role";
import { loadLiveData, parseSources, persistAlerts, runLiveEngine } from "@/lib/early-warning/server";

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

export async function GET(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  try {
    const sources = parseSources(new URL(request.url));
    const data = await loadLiveData(auth.supabase);
    const report = runLiveEngine(data, sources);
    return Response.json({ report, warnings: data.warnings, sources, role: auth.role });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Early warning failed." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { resident_ids?: unknown };
  const residentIds = Array.isArray(body.resident_ids)
    ? body.resident_ids.filter((x): x is string => typeof x === "string").slice(0, 200)
    : null;

  try {
    const data = await loadLiveData(auth.supabase);
    const report = runLiveEngine(data, parseSources(new URL(request.url)));
    const result = await persistAlerts(auth.supabase, report, residentIds);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Saving alerts failed." }, { status: 500 });
  }
}
