/**
 * Server-side data access for the Early Warning engine, behaviour analysis
 * and shift handover. Always called with a Supabase client that acts as the
 * signed-in user (see requireCareRole), so row-level security applies.
 */

import type { createClient } from "@/lib/supabase/server";
import {
  runEarlyWarning,
  toBehaviorAlertRows,
  WINDOW_DAYS,
  type CareLogInput,
  type FacilityReport,
  type FamilyContactInput,
  type FamilyMessageInput,
  type ResidentInput,
} from "@/lib/early-warning/engine";


type CareLogWithVitals = CareLogInput & { systolic?: number | null };

export type Supa = Awaited<ReturnType<typeof createClient>>;

/** Calendar days are counted in the care home's zone, not the server's. */
export const CARE_HOME_TZ = process.env.CARE_HOME_TIMEZONE || "Asia/Kolkata";

const INACTIVE = new Set(["discharged", "deceased", "inactive", "archived"]);
const PAGE = 1000; // PostgREST default max rows per request

export function parseSources(url: URL): string[] {
  const raw = url.searchParams.get("sources");
  const allowed = new Set(["manual", "sensor", "demo"]);
  const list = (raw ?? "manual")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => allowed.has(s));
  return list.length ? list : ["manual"];
}

export async function loadLiveData(supabase: Supa) {
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

  const logs: CareLogWithVitals[] = [];
  for (let page = 0; page < 30; page++) {
    const { data, error } = await supabase
      .from("care_logs_demo")
      .select(
        "resident_id, created_at, meals, fluids, mood, medication, pain_scale, heart_rate, temperature, systolic, entry_source"
      )
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`Could not load care logs: ${error.message}`);
    logs.push(...((data ?? []) as CareLogWithVitals[]));
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

/**
 * Writes each flagged signal into `behavior_alerts`, skipping any resident +
 * metric that already has an unresolved alert.
 */
export async function persistAlerts(
  supabase: Supa,
  report: FacilityReport,
  residentIds?: string[] | null
): Promise<{ inserted: number; skipped: number }> {
  const targets = report.residents.filter(
    (r) => r.flaggedSignals.length > 0 && (!residentIds || residentIds.includes(r.resident_id))
  );
  if (targets.length === 0) return { inserted: 0, skipped: 0 };

  const { data: open, error: openErr } = await supabase
    .from("behavior_alerts")
    .select("resident_id, metric")
    .eq("resolved", false)
    .in(
      "resident_id",
      targets.map((t) => t.resident_id)
    );
  if (openErr) throw new Error(`Could not read behaviour alerts: ${openErr.message}`);

  const existing = new Set((open ?? []).map((a) => `${a.resident_id}:${a.metric}`));
  const rows = targets.flatMap(toBehaviorAlertRows);
  const fresh = rows.filter((r) => !existing.has(`${r.resident_id}:${r.metric}`));

  if (fresh.length) {
    const { error } = await supabase.from("behavior_alerts").insert(fresh);
    if (error) throw new Error(`Could not save behaviour alerts: ${error.message}`);
  }
  return { inserted: fresh.length, skipped: rows.length - fresh.length };
}

export function runLiveEngine(data: Awaited<ReturnType<typeof loadLiveData>>, sources?: string[]) {
  return runEarlyWarning({
    residents: data.residents,
    logs: data.logs,
    familyContacts: data.familyContacts,
    familyMessages: data.familyMessages,
    allowedSources: sources,
    timeZone: CARE_HOME_TZ,
  });
}
