/**
 * Builds the care-score columns of `daily_aggregates` from real care logs.
 *
 * Until now nothing in ElderLink produced daily_aggregates; the table had to
 * be filled by hand or by a simulator. This turns the care_logs_demo entries
 * staff actually record into one row per resident per day, using the same
 * scales the Behaviour Alerts page already displays:
 *   meal_score, fluid_score, mood_score: 0–10
 *   medication_adherence:                 0–100
 *   avg_pain_scale, avg_heart_rate, avg_temperature (°F), avg_systolic
 *
 * Simulated sensor columns (sleep_hours, washroom_visits, sleep_disturbed,
 * activity_detail) are deliberately NOT produced here, so existing values in
 * those columns are never overwritten.
 */

import { dateKey, type CareLogInput, type ResidentInput } from "./engine.ts";

export type CareLogWithVitals = CareLogInput & { systolic?: number | null };

export type AggregateCareColumns = {
  resident_id: string;
  resident_name: string;
  room: string | null;
  date: string; // YYYY-MM-DD in the care home's time zone
  meal_score: number | null;
  fluid_score: number | null;
  mood_score: number | null;
  medication_adherence: number | null;
  avg_pain_scale: number | null;
  avg_heart_rate: number | null;
  avg_temperature: number | null;
  avg_systolic: number | null;
  /** Number of care-log entries the row was built from (not stored). */
  log_count: number;
};

const MEAL: Record<string, number> = { "Ate Fully": 10, Partially: 5, Refused: 0 };
const FLUID: Record<string, number> = { Good: 10, Low: 4, None: 0 };
const MOOD: Record<string, number> = { Happy: 10, Calm: 8, Agitated: 3, Confused: 2 };
const MED: Record<string, number> = { Given: 100, Refused: 0, Missed: 0 };

function avg(xs: number[], dp = 1): number | null {
  if (xs.length === 0) return null;
  const f = 10 ** dp;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * f) / f;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function push(map: Record<string, number>, raw: string | null | undefined, into: number[]) {
  if (!raw) return;
  const v = map[raw.trim()];
  if (v !== undefined) into.push(v);
}

export function buildDailyAggregates(opts: {
  residents: ResidentInput[];
  logs: CareLogWithVitals[];
  timeZone?: string;
  /** Only days on/after this YYYY-MM-DD are produced. */
  sinceDate?: string;
  allowedSources?: string[];
}): AggregateCareColumns[] {
  const allowed = new Set((opts.allowedSources ?? ["manual"]).map((s) => s.toLowerCase()));
  const residentById = new Map(opts.residents.map((r) => [r.id, r]));

  type Bucket = {
    meals: number[];
    fluids: number[];
    mood: number[];
    med: number[];
    pain: number[];
    hr: number[];
    temp: number[];
    sys: number[];
    n: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const log of opts.logs) {
    if (!log.resident_id || !residentById.has(log.resident_id)) continue;
    if (!allowed.has((log.entry_source ?? "manual").toLowerCase())) continue;
    const day = dateKey(log.created_at, opts.timeZone);
    if (opts.sinceDate && day < opts.sinceDate) continue;
    const key = `${log.resident_id}|${day}`;
    let b = buckets.get(key);
    if (!b) {
      b = { meals: [], fluids: [], mood: [], med: [], pain: [], hr: [], temp: [], sys: [], n: 0 };
      buckets.set(key, b);
    }
    b.n++;
    push(MEAL, log.meals, b.meals);
    push(FLUID, log.fluids, b.fluids);
    push(MOOD, log.mood, b.mood);
    push(MED, log.medication, b.med);
    const pain = num(log.pain_scale);
    if (pain !== null) b.pain.push(pain);
    const hr = num(log.heart_rate);
    if (hr !== null) b.hr.push(hr);
    const t = num(log.temperature);
    if (t !== null) b.temp.push(t);
    const s = num(log.systolic);
    if (s !== null) b.sys.push(s);
  }

  const rows: AggregateCareColumns[] = [];
  for (const [key, b] of buckets) {
    const [residentId, date] = key.split("|");
    const r = residentById.get(residentId)!;
    rows.push({
      resident_id: residentId,
      resident_name: r.full_name,
      room: r.room_number ?? null,
      date,
      meal_score: avg(b.meals),
      fluid_score: avg(b.fluids),
      mood_score: avg(b.mood),
      medication_adherence: avg(b.med, 0),
      avg_pain_scale: avg(b.pain),
      avg_heart_rate: avg(b.hr, 0),
      avg_temperature: avg(b.temp),
      avg_systolic: avg(b.sys, 0),
      log_count: b.n,
    });
  }
  rows.sort((a, b) => a.resident_id.localeCompare(b.resident_id) || a.date.localeCompare(b.date));
  return rows;
}
