/**
 * Shift handover builder.
 *
 * Pure function: turns everything recorded during a shift into a structured
 * handover for the incoming team. No AI is involved. Every line comes from
 * a database row, so the handover can be checked and trusted.
 *
 * Order of the handover (most urgent first):
 *   1. Priorities: residents the next shift must see first, with reasons
 *   2. Open emergencies / falls / behaviour alerts
 *   3. Residents with no care log this shift
 *   4. Per-resident summary of what was observed
 *   5. Assistance requests and notes from the shift
 */

import type { ResidentReport } from "../early-warning/engine.ts";

export type ShiftName = "Morning" | "Evening" | "Night";

export type ShiftLog = {
  resident_id: string | null;
  created_at: string;
  meals?: string | null;
  fluids?: string | null;
  mood?: string | null;
  medication?: string | null;
  notes?: string | null;
  pain_scale?: number | null;
  pain_note?: string | null;
  systolic?: number | null;
  diastolic?: number | null;
  heart_rate?: number | null;
  temperature?: number | null; // °F
  entry_source?: string | null;
};

export type HandoverResident = { id: string; full_name: string; room_number?: string | null };

export type HandoverInput = {
  shift: ShiftName;
  from: string; // ISO
  to: string; // ISO
  residents: HandoverResident[];
  logs: ShiftLog[];
  /** Early Warning results for the same residents (optional). */
  earlyWarning?: ResidentReport[];
  openFalls?: { resident_id: string | null; status?: string | null; triggered_at?: string | null }[];
  emergencies?: Record<string, unknown>[];
  openBehaviorAlerts?: { resident_id: string | null; resident_name?: string | null; metric?: string | null; severity?: string | null; message?: string | null }[];
  assistance?: Record<string, unknown>[];
  notes?: { note: string; created_at: string; shift?: string | null }[];
  authorName?: string | null;
  timeZone?: string;
};

export type ResidentShiftSummary = {
  resident_id: string;
  name: string;
  room: string | null;
  logCount: number;
  latest: { meals: string | null; fluids: string | null; mood: string | null; medication: string | null; at: string | null };
  concerns: string[];
  staffNotes: string[];
};

export type Priority = {
  resident_id: string;
  name: string;
  room: string | null;
  level: "urgent" | "high" | "watch";
  reasons: string[];
  actions: string[];
};

export type Handover = {
  shift: ShiftName;
  from: string;
  to: string;
  generatedAt: string;
  priorities: Priority[];
  openEmergencies: string[];
  notLogged: { resident_id: string; name: string; room: string | null }[];
  residents: ResidentShiftSummary[];
  assistance: string[];
  notes: string[];
  stats: { residents: number; logged: number; logs: number; simulatedExcluded: number };
  text: string;
};

/* ------------------------------------------------------------------ */

export function shiftFor(date: Date, timeZone?: string): { shift: ShiftName; start: Date } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const shift: ShiftName = hour >= 6 && hour < 14 ? "Morning" : hour >= 14 && hour < 22 ? "Evening" : "Night";
  const startHour = shift === "Morning" ? 6 : shift === "Evening" ? 14 : 22;
  let hoursIn = hour - startHour;
  if (hoursIn < 0) hoursIn += 24; // night shift after midnight
  const start = new Date(date.getTime() - (hoursIn * 60 + minute) * 60_000);
  start.setSeconds(0, 0);
  return { shift, start };
}

function timeLabel(iso: string, timeZone?: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso)
  );
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Things in a single log that the next shift should know about. */
export function logConcerns(log: ShiftLog): string[] {
  const c: string[] = [];
  if (log.meals === "Refused") c.push("refused a meal");
  if (log.fluids === "None") c.push("took no fluids");
  else if (log.fluids === "Low") c.push("low fluid intake");
  if (log.mood === "Confused") c.push("confused");
  else if (log.mood === "Agitated") c.push("agitated");
  if (log.medication === "Refused") c.push("refused medication");
  else if (log.medication === "Missed") c.push("medication missed");
  const pain = Number(log.pain_scale);
  if (log.pain_scale !== null && log.pain_scale !== undefined && pain >= 6)
    c.push(`pain ${pain}/10${log.pain_note ? ` (${log.pain_note})` : ""}`);
  const t = Number(log.temperature);
  if (log.temperature !== null && log.temperature !== undefined && t >= 99.5)
    c.push(`temperature ${t.toFixed(1)}°F (${(((t - 32) * 5) / 9).toFixed(1)}°C)`);
  const sys = Number(log.systolic);
  if (log.systolic != null && (sys >= 160 || sys <= 90)) c.push(`BP ${sys}/${log.diastolic ?? "?"}`);
  const hr = Number(log.heart_rate);
  if (log.heart_rate != null && (hr >= 100 || hr < 50)) c.push(`heart rate ${hr}`);
  return c;
}

/* ------------------------------------------------------------------ */

export function buildHandover(input: HandoverInput): Handover {
  const tz = input.timeZone;
  const allowed = new Set(["manual"]);
  const realLogs = input.logs.filter((l) => allowed.has((l.entry_source ?? "manual").toLowerCase()));
  const simulatedExcluded = input.logs.length - realLogs.length;

  const byResident = new Map<string, ShiftLog[]>();
  for (const l of realLogs) {
    if (!l.resident_id) continue;
    const arr = byResident.get(l.resident_id) ?? [];
    arr.push(l);
    byResident.set(l.resident_id, arr);
  }
  const ewById = new Map((input.earlyWarning ?? []).map((r) => [r.resident_id, r]));
  const nameById = new Map(input.residents.map((r) => [r.id, r]));

  // ---- per-resident summaries -----------------------------------------
  const residents: ResidentShiftSummary[] = input.residents.map((r) => {
    const logs = (byResident.get(r.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const last = logs[logs.length - 1];
    const concerns: string[] = [];
    for (const l of logs) {
      for (const c of logConcerns(l)) concerns.push(`${timeLabel(l.created_at, tz)} ${c}`);
    }
    const staffNotes = logs
      .filter((l) => l.notes && l.notes.trim())
      .map((l) => `${timeLabel(l.created_at, tz)} ${l.notes!.trim()}`);
    return {
      resident_id: r.id,
      name: r.full_name,
      room: r.room_number ?? null,
      logCount: logs.length,
      latest: {
        meals: last?.meals ?? null,
        fluids: last?.fluids ?? null,
        mood: last?.mood ?? null,
        medication: last?.medication ?? null,
        at: last ? last.created_at : null,
      },
      concerns,
      staffNotes,
    };
  });

  const notLogged = residents
    .filter((r) => r.logCount === 0)
    .map((r) => ({ resident_id: r.resident_id, name: r.name, room: r.room }));

  // ---- open emergencies -----------------------------------------------
  const openEmergencies: string[] = [];
  const priorityMap = new Map<string, Priority>();
  const bump = (id: string | null | undefined, level: Priority["level"], reason: string, action?: string) => {
    if (!id) return;
    const r = nameById.get(id);
    if (!r) return;
    const rank = { urgent: 3, high: 2, watch: 1 };
    const p =
      priorityMap.get(id) ??
      ({ resident_id: id, name: r.full_name, room: r.room_number ?? null, level, reasons: [], actions: [] } as Priority);
    if (rank[level] > rank[p.level]) p.level = level;
    if (!p.reasons.includes(reason)) p.reasons.push(reason);
    if (action && !p.actions.includes(action)) p.actions.push(action);
    priorityMap.set(id, p);
  };

  for (const f of input.openFalls ?? []) {
    const r = f.resident_id ? nameById.get(f.resident_id) : null;
    const when = f.triggered_at ? ` at ${timeLabel(f.triggered_at, tz)}` : "";
    openEmergencies.push(`Fall alert still ${f.status ?? "open"}${when}: ${r?.full_name ?? "unknown resident"}`);
    bump(f.resident_id, "urgent", `Unresolved fall alert${when}`, "Check on the resident and close the fall alert");
  }
  for (const e of input.emergencies ?? []) {
    const status = str(e.status).toLowerCase();
    const resolved = e.resolved === true || status === "resolved" || !!e.resolved_at;
    const rid = str(e.resident_id) || null;
    const r = rid ? nameById.get(rid) : null;
    const type = str(e.type || e.alert_type || "SOS");
    const when = e.created_at ? ` at ${timeLabel(str(e.created_at), tz)}` : "";
    openEmergencies.push(`${type.toUpperCase()} alert${when}: ${r?.full_name ?? "resident"}${resolved ? " (resolved)" : ""}`);
    if (!resolved) bump(rid, "urgent", `${type} alert raised${when}`, "Follow up on the emergency alert");
    else bump(rid, "high", `${type} alert raised this shift${when}`);
  }
  for (const a of input.openBehaviorAlerts ?? []) {
    if (!a.resident_id) continue;
    const sev = (a.severity ?? "").toLowerCase();
    bump(
      a.resident_id,
      sev === "severe" ? "high" : "watch",
      `Open behaviour alert: ${a.message ?? a.metric ?? "change from baseline"}`.replace(/^Open behaviour alert: \[Early Warning\] /, "Open behaviour alert: ")
    );
  }

  // ---- early-warning + shift concerns ----------------------------------
  for (const s of residents) {
    const ew = ewById.get(s.resident_id);
    if (ew && (ew.status === "act" || ew.status === "watch")) {
      bump(s.resident_id, ew.status === "act" ? "high" : "watch", ew.summary);
      for (const a of ew.topActions.slice(0, 2)) bump(s.resident_id, "watch", ew.summary, a);
    }
    if (s.concerns.length >= 2) bump(s.resident_id, "high", `This shift: ${s.concerns.slice(0, 3).join("; ")}`);
    else if (s.concerns.length === 1) bump(s.resident_id, "watch", `This shift: ${s.concerns[0]}`);
    if (s.logCount === 0) bump(s.resident_id, "watch", "No care log this shift", "Do a care check early in the shift");
  }

  const order = { urgent: 0, high: 1, watch: 2 };
  const priorities = [...priorityMap.values()].sort(
    (a, b) => order[a.level] - order[b.level] || b.reasons.length - a.reasons.length || a.name.localeCompare(b.name)
  );

  // ---- assistance + notes ---------------------------------------------
  const assistance = (input.assistance ?? []).map((a) => {
    const rid = str(a.resident_id) || null;
    const r = rid ? nameById.get(rid) : null;
    const when = a.created_at ? timeLabel(str(a.created_at), tz) : "";
    const msg = str(a.message) || "Assistance requested";
    const st = str(a.status) || "open";
    return `${when} ${r ? `${r.full_name}: ` : ""}${msg} [${st}]`.trim();
  });
  const notes = (input.notes ?? []).map((n) => `${timeLabel(n.created_at, tz)} ${n.note.split("\n")[0].slice(0, 200)}`);

  const logged = residents.length - notLogged.length;
  const base: Omit<Handover, "text"> = {
    shift: input.shift,
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    priorities,
    openEmergencies,
    notLogged,
    residents,
    assistance,
    notes,
    stats: { residents: residents.length, logged, logs: realLogs.length, simulatedExcluded },
  };
  return { ...base, text: handoverText(base, input.authorName, tz) };
}

/* ------------------------------------------------------------------ */

export function handoverText(h: Omit<Handover, "text">, author?: string | null, tz?: string): string {
  const L: string[] = [];
  const room = (r: string | null) => (r ? ` (Rm ${r})` : "");
  L.push(
    `${h.shift.toUpperCase()} SHIFT HANDOVER · ${timeLabel(h.from, tz)}–${timeLabel(h.to, tz)}` +
      (author ? ` · by ${author}` : "")
  );
  L.push(`${h.stats.logged}/${h.stats.residents} residents logged · ${h.stats.logs} care entries`);
  L.push("");

  L.push("SEE FIRST:");
  if (h.priorities.length === 0) L.push("- No priorities. All residents within their usual range.");
  for (const p of h.priorities.slice(0, 8)) {
    L.push(`- [${p.level.toUpperCase()}] ${p.name}${room(p.room)}: ${p.reasons.slice(0, 3).join("; ")}`);
    if (p.actions.length) L.push(`    → ${p.actions.slice(0, 2).join("; ")}`);
  }
  if (h.priorities.length > 8) L.push(`- …and ${h.priorities.length - 8} more (see ElderLink)`);

  if (h.openEmergencies.length) {
    L.push("");
    L.push("EMERGENCIES THIS SHIFT:");
    for (const e of h.openEmergencies) L.push(`- ${e}`);
  }

  if (h.notLogged.length) {
    L.push("");
    L.push(`NOT LOGGED THIS SHIFT (${h.notLogged.length}): ${h.notLogged.map((r) => `${r.name}${room(r.room)}`).join(", ")}`);
  }

  const withNotes = h.residents.filter((r) => r.staffNotes.length);
  if (withNotes.length) {
    L.push("");
    L.push("STAFF NOTES:");
    for (const r of withNotes) for (const n of r.staffNotes.slice(-2)) L.push(`- ${r.name}: ${n}`);
  }

  if (h.assistance.length) {
    L.push("");
    L.push("ASSISTANCE REQUESTS:");
    for (const a of h.assistance) L.push(`- ${a}`);
  }

  if (h.notes.length) {
    L.push("");
    L.push("NOTES POSTED THIS SHIFT:");
    for (const n of h.notes) L.push(`- ${n}`);
  }
  return L.join("\n");
}
