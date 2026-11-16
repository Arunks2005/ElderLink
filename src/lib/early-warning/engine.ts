/**
 * ElderLink Early Warning engine ("Silent Decline Radar").
 *
 * Pure, dependency-free TypeScript so it can run on the server, in the
 * browser, or in a plain Node test script.
 *
 * What it does, per resident:
 *   1. Turns the ordinary care-log entries staff already record (meals,
 *      fluids, mood, medication, pain, vitals) into one number per day per
 *      signal.
 *   2. Learns that resident's OWN normal over one week (days 5–11 ago,
 *      a personal baseline) instead of one threshold for everybody.
 *      Night-time sensor summaries (sleep hours, bathroom visits, bed exits,
 *      breathing rate from bed mats and the ward's bathroom radar) are
 *      analysed the same way as the care-log signals.
 *   3. Compares the last 3 days with that baseline using a z-score, with a
 *      minimum standard deviation per signal so tiny wobbles are ignored.
 *   4. Looks for clinically recognised combinations of signals (for example
 *      falling fluids + new confusion) and turns them into plain-language
 *      screening prompts with concrete actions.
 *   5. Adds two social signals that sensors and vitals miss:
 *        - connection gap: days since the family last made contact
 *        - attention equity: residents who are being observed far less
 *          often than everybody else (the "quiet resident" problem).
 *
 * Every output is explainable: each flag says which numbers moved, by how
 * much, and against which baseline. Nothing here is a diagnosis.
 */

/* ------------------------------------------------------------------ */
/* Input types (match existing Supabase tables)                         */
/* ------------------------------------------------------------------ */

export type CareLogInput = {
  resident_id: string | null;
  created_at: string;
  meals?: string | null;
  fluids?: string | null;
  mood?: string | null;
  medication?: string | null;
  pain_scale?: number | null;
  heart_rate?: number | null;
  temperature?: number | null; // °F, as stored by the care-log page
  entry_source?: string | null; // 'manual' | 'sensor' | 'demo'
  // Night-time sensor summary fields (only on rows built from SensorDayInput).
  sleep_hours?: number | null;
  washroom_visits?: number | null;
  night_bed_exits?: number | null;
  night_breathing_rate?: number | null;
};

/** One night's sensor summary for one resident (daily_aggregates row). */
export type SensorDayInput = {
  resident_id: string;
  date: string; // YYYY-MM-DD: the night that ended on this morning
  sleep_hours?: number | null;
  washroom_visits?: number | null;
  night_bed_exits?: number | null;
  night_breathing_rate?: number | null;
  sensor_source?: string | null; // 'simulated' | 'device'
};

export type ResidentInput = {
  id: string;
  full_name: string;
  room_number?: string | null;
};

export type FamilyContactInput = {
  resident_id: string;
  full_name: string;
  relationship?: string | null;
  phone?: string | null;
  is_primary?: boolean | null;
};

export type FamilyMessageInput = {
  resident_id: string | null;
  created_at: string;
  sender_role?: string | null;
};

export type EngineInput = {
  residents: ResidentInput[];
  logs: CareLogInput[];
  familyContacts?: FamilyContactInput[];
  familyMessages?: FamilyMessageInput[];
  now?: Date;
  /**
   * Which entry_source values count as real observations.
   * Default: only 'manual' — simulated sensor/demo rows are excluded so they
   * cannot create or hide a flag.
   */
  allowedSources?: string[];
  /** Nightly sensor summaries; always analysed (each is labelled as sensor data). */
  sensorDays?: SensorDayInput[];
  /** IANA zone for calendar days, e.g. "Asia/Kolkata". Default: machine local time. */
  timeZone?: string;
};

/* ------------------------------------------------------------------ */
/* Output types                                                        */
/* ------------------------------------------------------------------ */

export type Severity = "mild" | "moderate" | "severe";
export type ResidentStatus = "act" | "watch" | "stable" | "baseline";

export type MetricKey =
  | "fluids"
  | "meals"
  | "mood"
  | "confusion"
  | "medication"
  | "pain"
  | "temperature"
  | "heart_rate"
  | "sleep_hours"
  | "washroom_visits"
  | "night_bed_exits"
  | "night_breathing";

export type SignalResult = {
  key: MetricKey;
  /** Where the numbers come from: staff care logs or ward sensors. */
  source: "care_log" | "sensor";
  label: string;
  unit: string;
  worseWhen: "lower" | "higher";
  baselineMean: number | null;
  baselineSd: number | null;
  recentMean: number | null;
  baselineDays: number;
  recentDays: number;
  /** Positive = moved in the WORSE direction, in personal standard deviations. */
  deviation: number | null;
  severity: Severity | null;
  /** Recent days individually beyond 1 SD in the worse direction. */
  persistentDays: number;
  explanation: string | null;
  /** Daily values, oldest → newest (index WINDOW_DAYS-1 = today). */
  series: (number | null)[];
};

export type PatternResult = {
  id:
    | "hydration_confusion"
    | "withdrawal"
    | "medication_refusal"
    | "pain"
    | "vitals"
    | "urinary"
    | "night_restlessness"
    | "night_breathing";
  title: string;
  severity: Severity;
  evidence: string[];
  why: string;
  actions: string[];
};

export type ConnectionResult = {
  registeredContacts: number;
  primaryContact: FamilyContactInput | null;
  lastFamilyContactAt: string | null;
  daysSinceFamilyContact: number | null;
  /** 'none' = no family registered at all; 'gap' = >7 days; 'ok' otherwise. */
  status: "ok" | "gap" | "none";
  lonelinessRisk: boolean;
  explanation: string;
};

export type AttentionResult = {
  logsLast7Days: number;
  facilityMedianLast7Days: number;
  ratioToMedian: number | null;
  hoursSinceLastLog: number | null;
  underObserved: boolean;
  notObservedToday: boolean;
  explanation: string | null;
};

export type ResidentReport = {
  resident_id: string;
  name: string;
  firstName: string;
  room: string | null;
  status: ResidentStatus;
  driftIndex: number; // 0–100
  priorityScore: number;
  signals: SignalResult[];
  flaggedSignals: SignalResult[];
  patterns: PatternResult[];
  connection: ConnectionResult;
  attention: AttentionResult;
  summary: string;
  topActions: string[];
  dataQuality: {
    logsUsed: number;
    logsExcluded: number;
    baselineDaysWithData: number;
  };
};

export type FacilityReport = {
  generatedAt: string;
  windowDays: number;
  baselineRange: [number, number]; // days ago, inclusive
  recentRange: [number, number];
  residents: ResidentReport[]; // sorted by priorityScore (care-rounds order)
  totals: {
    residents: number;
    act: number;
    watch: number;
    stable: number;
    buildingBaseline: number;
    connectionGaps: number;
    noFamily: number;
    underObserved: number;
    notObservedToday: number;
    logsUsed: number;
    logsExcluded: number;
  };
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export const WINDOW_DAYS = 14; // two weeks shown in the charts
export const RECENT_DAYS = 3; // "present": days ago 0..2
// "Normal": one week, days ago 4..10. Day 3 is a one-day buffer so the start
// of a change doesn't immediately become part of the normal it is compared with.
export const BASELINE_START = 4;
export const BASELINE_END = 10;
export const MIN_BASELINE_DAYS = 5;
export const MIN_RECENT_DAYS = 2;
export const CONNECTION_GAP_DAYS = 7;

const SEVERITY_THRESHOLDS: { level: Severity; z: number }[] = [
  { level: "severe", z: 3 },
  { level: "moderate", z: 2 },
  { level: "mild", z: 1.5 },
];

type MetricDef = {
  key: MetricKey;
  label: string;
  unit: string;
  worseWhen: "lower" | "higher";
  /** Smallest SD we trust — stops a very consistent resident being flagged for noise. */
  sdFloor: number;
  weight: number;
  /** Per-log value; null = this log says nothing about the metric. */
  fromLog: (log: CareLogInput) => number | null;
  /** 'sensor' metrics read nightly sensor rows instead of care logs. */
  source?: "care_log" | "sensor";
  /** How to combine a day's values. */
  aggregate: "mean" | "max";
  format: (v: number) => string;
};

const pct = (v: number) => `${Math.round(v)}%`;

const MEAL_SCORE: Record<string, number> = { "Ate Fully": 100, Partially: 50, Refused: 0 };
const FLUID_SCORE: Record<string, number> = { Good: 100, Low: 40, None: 0 };
const MOOD_SCORE: Record<string, number> = { Happy: 100, Calm: 80, Agitated: 30, Confused: 20 };
const MED_SCORE: Record<string, number> = { Given: 100, Refused: 0, Missed: 0 };

function lookup(table: Record<string, number>, raw: string | null | undefined) {
  if (!raw) return null;
  const v = table[raw.trim()];
  return v === undefined ? null : v;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const METRICS: MetricDef[] = [
  {
    key: "fluids",
    label: "Hydration",
    unit: "%",
    worseWhen: "lower",
    sdFloor: 10,
    weight: 1.2,
    fromLog: (l) => lookup(FLUID_SCORE, l.fluids),
    aggregate: "mean",
    format: pct,
  },
  {
    key: "meals",
    label: "Meal intake",
    unit: "%",
    worseWhen: "lower",
    sdFloor: 10,
    weight: 1,
    fromLog: (l) => lookup(MEAL_SCORE, l.meals),
    aggregate: "mean",
    format: pct,
  },
  {
    key: "mood",
    label: "Mood",
    unit: "%",
    worseWhen: "lower",
    sdFloor: 8,
    weight: 1,
    fromLog: (l) => lookup(MOOD_SCORE, l.mood),
    aggregate: "mean",
    format: pct,
  },
  {
    key: "confusion",
    label: "Confusion episodes",
    unit: "% of logs",
    worseWhen: "higher",
    sdFloor: 8,
    weight: 1.2,
    fromLog: (l) => (l.mood ? (l.mood.trim() === "Confused" ? 100 : 0) : null),
    aggregate: "mean",
    format: (v) => `${Math.round(v)}% of logs`,
  },
  {
    key: "medication",
    label: "Medication taken",
    unit: "%",
    worseWhen: "lower",
    sdFloor: 8,
    weight: 1,
    fromLog: (l) => lookup(MED_SCORE, l.medication),
    aggregate: "mean",
    format: pct,
  },
  {
    key: "pain",
    label: "Pain score",
    unit: "/10",
    worseWhen: "higher",
    sdFloor: 1,
    weight: 0.8,
    fromLog: (l) => numberOrNull(l.pain_scale),
    aggregate: "mean",
    format: (v) => `${v.toFixed(1)}/10`,
  },
  {
    key: "temperature",
    label: "Temperature",
    unit: "°F",
    worseWhen: "higher",
    sdFloor: 0.5,
    weight: 1,
    fromLog: (l) => numberOrNull(l.temperature),
    aggregate: "max",
    format: (v) => `${v.toFixed(1)}°F`,
  },
  {
    key: "heart_rate",
    label: "Heart rate",
    unit: "bpm",
    worseWhen: "higher",
    sdFloor: 5,
    weight: 0.6,
    fromLog: (l) => numberOrNull(l.heart_rate),
    aggregate: "mean",
    format: (v) => `${Math.round(v)} bpm`,
  },
  // ---- night-time sensors (bed mat + ward bathroom radar) ----
  {
    key: "sleep_hours",
    source: "sensor",
    label: "Sleep",
    unit: "h",
    worseWhen: "lower",
    sdFloor: 0.5,
    weight: 1,
    fromLog: (l) => numberOrNull(l.sleep_hours),
    aggregate: "mean",
    format: (v) => `${v.toFixed(1)} h`,
  },
  {
    key: "washroom_visits",
    source: "sensor",
    label: "Night bathroom visits",
    unit: "/night",
    worseWhen: "higher",
    sdFloor: 0.7,
    weight: 1,
    fromLog: (l) => numberOrNull(l.washroom_visits),
    aggregate: "mean",
    format: (v) => `${v.toFixed(1)}/night`,
  },
  {
    key: "night_bed_exits",
    source: "sensor",
    label: "Night bed exits",
    unit: "/night",
    worseWhen: "higher",
    sdFloor: 0.7,
    weight: 0.8,
    fromLog: (l) => numberOrNull(l.night_bed_exits),
    aggregate: "mean",
    format: (v) => `${v.toFixed(1)}/night`,
  },
  {
    key: "night_breathing",
    source: "sensor",
    label: "Breathing while asleep",
    unit: "/min",
    worseWhen: "higher",
    sdFloor: 1,
    weight: 1,
    fromLog: (l) => numberOrNull(l.night_breathing_rate),
    aggregate: "mean",
    format: (v) => `${v.toFixed(1)}/min`,
  },
];

/** A sensor night as a pseudo-log dated at 12:00 UTC (same calendar day in any zone between UTC-11 and UTC+11). */
function sensorDayToLog(d: SensorDayInput): CareLogInput {
  return {
    resident_id: d.resident_id,
    created_at: `${d.date.slice(0, 10)}T12:00:00.000Z`,
    entry_source: "sensor_feed",
    sleep_hours: d.sleep_hours ?? null,
    washroom_visits: d.washroom_visits ?? null,
    night_bed_exits: d.night_bed_exits ?? null,
    night_breathing_rate: d.night_breathing_rate ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* Small statistics helpers                                            */
/* ------------------------------------------------------------------ */

const DAY_MS = 86_400_000;

/**
 * Calendar day used for "today / yesterday". Set per run from
 * EngineInput.timeZone so a server running in UTC still uses the care
 * home's local days (e.g. Asia/Kolkata). Undefined = the machine's local time.
 */
let activeTimeZone: string | undefined;

/** YYYY-MM-DD for an instant, in the given IANA time zone (or local time). */
export function dateKey(d: Date | string, timeZone?: string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  if (!timeZone) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${m}-${day}`;
  }
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function dayNumber(d: Date | string, timeZone?: string) {
  const [y, m, day] = dateKey(d, timeZone).split("-").map(Number);
  return Date.UTC(y, m - 1, day) / DAY_MS;
}

/** 0 = today, 1 = yesterday … based on calendar days in the active time zone. */
export function daysAgo(iso: string, now: Date, timeZone: string | undefined = activeTimeZone): number {
  return dayNumber(now, timeZone) - dayNumber(iso, timeZone);
}

function mean(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleSd(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

function median(xs: number[]) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function round(v: number, dp = 1) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

function severityFor(dev: number): Severity | null {
  for (const t of SEVERITY_THRESHOLDS) if (dev >= t.z) return t.level;
  return null;
}

const SEVERITY_RANK: Record<Severity, number> = { mild: 1, moderate: 2, severe: 3 };

function maxSeverity(list: (Severity | null)[]): Severity {
  let best: Severity = "mild";
  for (const s of list) if (s && SEVERITY_RANK[s] > SEVERITY_RANK[best]) best = s;
  return best;
}

export function firstNameOf(full: string) {
  return (full || "Resident").trim().split(/\s+/)[0];
}

/* ------------------------------------------------------------------ */
/* Per-signal analysis                                                 */
/* ------------------------------------------------------------------ */

function analyseSignal(def: MetricDef, logs: CareLogInput[], now: Date, firstName: string): SignalResult {
  const buckets: number[][] = Array.from({ length: WINDOW_DAYS }, () => []);
  for (const log of logs) {
    const ago = daysAgo(log.created_at, now);
    if (ago < 0 || ago >= WINDOW_DAYS) continue;
    const v = def.fromLog(log);
    if (v === null) continue;
    buckets[ago].push(v);
  }

  const byAgo: (number | null)[] = buckets.map((b) =>
    b.length === 0 ? null : def.aggregate === "max" ? Math.max(...b) : mean(b)
  );

  const baselineVals: number[] = [];
  for (let a = BASELINE_START; a <= BASELINE_END; a++) {
    const v = byAgo[a];
    if (v !== null) baselineVals.push(v);
  }
  const recentVals: number[] = [];
  for (let a = 0; a < RECENT_DAYS; a++) {
    const v = byAgo[a];
    if (v !== null) recentVals.push(v);
  }

  const series = [...byAgo].reverse().map((v) => (v === null ? null : round(v, 2)));

  const base: SignalResult = {
    key: def.key,
    source: def.source ?? "care_log",
    label: def.label,
    unit: def.unit,
    worseWhen: def.worseWhen,
    baselineMean: null,
    baselineSd: null,
    recentMean: null,
    baselineDays: baselineVals.length,
    recentDays: recentVals.length,
    deviation: null,
    severity: null,
    persistentDays: 0,
    explanation: null,
    series,
  };

  if (baselineVals.length < MIN_BASELINE_DAYS || recentVals.length < MIN_RECENT_DAYS) {
    return base;
  }

  const bMean = mean(baselineVals);
  const sd = Math.max(sampleSd(baselineVals), def.sdFloor);
  const rMean = mean(recentVals);
  const sign = def.worseWhen === "lower" ? -1 : 1;
  const deviation = (sign * (rMean - bMean)) / sd;
  const persistentDays = recentVals.filter((v) => (sign * (v - bMean)) / sd >= 1).length;

  // A single bad day inside a 3-day window is not a trend: require the move
  // to show on at least 2 separate days before raising it.
  let severity = severityFor(deviation);
  if (severity && persistentDays < 2) severity = null;

  let explanation: string | null = null;
  if (severity) {
    const verb = def.worseWhen === "lower" ? "fell" : "rose";
    explanation =
      `${def.label} ${verb} from ${firstName}'s usual ${def.format(bMean)} ` +
      `to ${def.format(rMean)} over the last ${RECENT_DAYS} days ` +
      `(${round(deviation, 1)} personal SD, on ${persistentDays} of ${recentVals.length} days).`;
  }

  return {
    ...base,
    baselineMean: round(bMean, 2),
    baselineSd: round(sd, 2),
    recentMean: round(rMean, 2),
    deviation: round(deviation, 2),
    severity,
    persistentDays,
    explanation,
  };
}

/* ------------------------------------------------------------------ */
/* Pattern rules: combinations of signals → screening prompts          */
/* ------------------------------------------------------------------ */

function detectPatterns(
  sig: Record<MetricKey, SignalResult>,
  connection: ConnectionResult,
  firstName: string
): PatternResult[] {
  const flagged = (k: MetricKey) => sig[k].severity !== null;
  const patterns: PatternResult[] = [];

  if (flagged("fluids") && (flagged("confusion") || flagged("mood") || flagged("temperature"))) {
    const involved: MetricKey[] = (["fluids", "confusion", "mood", "temperature", "washroom_visits"] as MetricKey[]).filter(flagged);
    patterns.push({
      id: "hydration_confusion",
      title: "Low fluids with new confusion or mood change",
      severity: maxSeverity(involved.map((k) => sig[k].severity)),
      evidence: involved.map((k) => sig[k].explanation!).filter(Boolean),
      why:
        "In older adults, drinking less together with new confusion is a common early sign of " +
        "dehydration or a urinary infection. These often show up without fever or obvious symptoms.",
      actions: [
        `Offer ${firstName} a drink every hour while awake and record each one`,
        "Check temperature and pulse this shift",
        "Ask the nurse to screen for dehydration / urinary infection (urine colour, frequency, pain)",
      ],
    });
  }

  if (flagged("meals") && flagged("mood") && !flagged("confusion")) {
    const evidence = [sig.meals.explanation!, sig.mood.explanation!];
    if (connection.status !== "ok") evidence.push(connection.explanation);
    patterns.push({
      id: "withdrawal",
      title:
        connection.status === "ok"
          ? "Eating less and lower mood"
          : "Eating less, lower mood and no family contact",
      severity: maxSeverity([sig.meals.severity, sig.mood.severity, connection.status !== "ok" ? "moderate" : null]),
      evidence,
      why:
        "Eating less together with low mood can be an early sign of withdrawal, loneliness or depression. " +
        "In residential care these signs are easy to miss because the resident stops asking for anything.",
      actions: [
        `Spend 10 unhurried minutes talking with ${firstName} today`,
        "Invite them to a group activity they used to enjoy (prayer, music, games, garden)",
        connection.status === "none"
          ? "No family registered: pair them with a volunteer befriender"
          : "Send the family a gentle call request (see Connection below)",
        "Ask the nurse to consider a depression screen (e.g. GDS-15) if this continues",
      ],
    });
  }

  if (flagged("medication")) {
    const ev = [sig.medication.explanation!];
    if (flagged("confusion")) ev.push(sig.confusion.explanation!);
    patterns.push({
      id: "medication_refusal",
      title: "Medication being refused or missed more often",
      severity: sig.medication.severity!,
      evidence: ev,
      why:
        "A rise in refused doses usually has a cause: side effects, difficulty swallowing, confusion or fear. " +
        "Missed doses can also make chronic conditions worse.",
      actions: [
        `Ask ${firstName} calmly why the dose is being refused (taste, swallowing, side effects)`,
        "Do not force the dose. Inform the nurse/doctor today",
        "Check whether the timing or form (tablet/syrup) can be changed",
      ],
    });
  }

  if (flagged("pain")) {
    patterns.push({
      id: "pain",
      title: "Pain is higher than usual",
      severity: sig.pain.severity!,
      evidence: [sig.pain.explanation!],
      why: "A sustained rise in pain can follow an unreported fall, a pressure sore, or a worsening condition.",
      actions: [
        "Do a structured pain check: where it hurts, when, and what makes it worse",
        "Check skin and pressure areas, and ask about any recent falls",
        "Report to the nurse if the pain score stays above usual tomorrow",
      ],
    });
  }

  const vitalKeys: MetricKey[] = (["temperature", "heart_rate"] as MetricKey[]).filter(flagged);
  if (vitalKeys.length && !patterns.some((p) => p.id === "hydration_confusion")) {
    patterns.push({
      id: "vitals",
      title: "Vital signs above this resident's normal",
      severity: maxSeverity(vitalKeys.map((k) => sig[k].severity)),
      evidence: vitalKeys.map((k) => sig[k].explanation!),
      why: "Older adults often run lower temperatures, so a reading that is normal for others can be high for them.",
      actions: ["Recheck vitals in 2 hours", "Inform the nurse if still raised"],
    });
  }

  // ---- night-time sensor patterns ----
  const hydrationAlready = patterns.some((p) => p.id === "hydration_confusion");

  if (flagged("washroom_visits") && !hydrationAlready) {
    const ev = [sig.washroom_visits.explanation!];
    const withInfectionSigns = flagged("confusion") || flagged("temperature");
    if (flagged("confusion")) ev.push(sig.confusion.explanation!);
    if (flagged("temperature")) ev.push(sig.temperature.explanation!);
    patterns.push({
      id: "urinary",
      title: withInfectionSigns ? "More night bathroom trips with confusion or fever" : "More night-time bathroom trips",
      severity: maxSeverity([sig.washroom_visits.severity, withInfectionSigns ? "severe" : null]),
      evidence: ev,
      why:
        "A rise in night-time bathroom trips can be an early sign of a urinary infection, high blood sugar or a change in " +
        "fluid timing, and every trip in the dark is a fall risk." +
        (withInfectionSigns ? " Combined with confusion or a raised temperature, a urinary infection is a real possibility." : ""),
      actions: [
        `Ask ${firstName} about burning, urgency or pain when passing urine`,
        "Check urine colour and smell. Ask the nurse about a urine test",
        "Keep a night light on the way to the bathroom, or offer a bedside commode",
      ],
    });
  }

  if (flagged("night_bed_exits") || flagged("sleep_hours")) {
    const involved = (["night_bed_exits", "sleep_hours"] as MetricKey[]).filter(flagged);
    const ev = involved.map((k) => sig[k].explanation!);
    if (flagged("pain")) ev.push(sig.pain.explanation!);
    patterns.push({
      id: "night_restlessness",
      title: flagged("night_bed_exits") ? "Restless nights: getting out of bed more often" : "Sleeping less than usual",
      severity: maxSeverity([...involved.map((k) => sig[k].severity), flagged("confusion") ? "moderate" : null]),
      evidence: ev,
      why:
        "Broken sleep and frequent getting up usually have a cause: pain, needing the toilet, breathlessness, worry, or " +
        "confusion that is worse at night (delirium). Getting up at night is also when most falls happen.",
      actions: [
        `Ask ${firstName} what is waking them (pain, toilet, breathing, worry)`,
        "Keep the bed-exit alert on and a night light on. Check footwear and bed height",
        "Tell the nurse if new confusion appears, or if this continues for 2 more nights",
      ],
    });
  }

  if (flagged("night_breathing")) {
    patterns.push({
      id: "night_breathing",
      title: "Breathing faster than usual while asleep",
      severity: sig.night_breathing.severity!,
      evidence: [sig.night_breathing.explanation!],
      why:
        "A steady rise in breathing rate during sleep can come days before a chest infection or worsening heart " +
        "failure is obvious in the daytime.",
      actions: [
        "Check temperature and, if available, oxygen level this shift",
        "Listen for cough, breathlessness or new ankle swelling",
        "Ask the nurse to review today",
      ],
    });
  }

  // If most night exits are NOT bathroom trips, restlessness is the better
  // first explanation than a urinary problem.
  const ui = patterns.findIndex((p) => p.id === "urinary");
  const ri = patterns.findIndex((p) => p.id === "night_restlessness");
  const exitsNow = sig.night_bed_exits.recentMean;
  const tripsNow = sig.washroom_visits.recentMean;
  if (ui >= 0 && ri > ui && exitsNow !== null && tripsNow !== null && exitsNow - tripsNow >= 1) {
    const [rest] = patterns.splice(ri, 1);
    patterns.splice(ui, 0, rest);
  }

  return patterns;
}

/* ------------------------------------------------------------------ */
/* Social signals                                                      */
/* ------------------------------------------------------------------ */

function isFamilySender(role: string | null | undefined) {
  if (!role) return true; // older rows without a role are treated as family
  const r = role.toLowerCase();
  return !(r.includes("staff") || r.includes("admin") || r.includes("system"));
}

function analyseConnection(
  residentId: string,
  firstName: string,
  contacts: FamilyContactInput[],
  messages: FamilyMessageInput[],
  now: Date,
  moodDeclining: boolean
): ConnectionResult {
  const mine = contacts.filter((c) => c.resident_id === residentId);
  const primary = mine.find((c) => c.is_primary) ?? mine[0] ?? null;

  const familyMsgs = messages
    .filter((m) => m.resident_id === residentId && isFamilySender(m.sender_role))
    .map((m) => m.created_at)
    .sort();
  const last = familyMsgs.length ? familyMsgs[familyMsgs.length - 1] : null;
  const days = last ? Math.max(0, daysAgo(last, now)) : null;

  if (mine.length === 0) {
    return {
      registeredContacts: 0,
      primaryContact: null,
      lastFamilyContactAt: last,
      daysSinceFamilyContact: days,
      status: "none",
      lonelinessRisk: true,
      explanation: `${firstName} has no registered family contact. Residents without family are at the highest risk of isolation.`,
    };
  }

  const gap = days === null || days > CONNECTION_GAP_DAYS;
  return {
    registeredContacts: mine.length,
    primaryContact: primary,
    lastFamilyContactAt: last,
    daysSinceFamilyContact: days,
    status: gap ? "gap" : "ok",
    lonelinessRisk: gap && moodDeclining,
    explanation: gap
      ? days === null
        ? `No family message recorded for ${firstName} in the last 60 days.`
        : `Family last made contact ${days} days ago.`
      : `Family made contact ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`}.`,
  };
}

/* ------------------------------------------------------------------ */
/* Main entry                                                          */
/* ------------------------------------------------------------------ */

export function runEarlyWarning(input: EngineInput): FacilityReport {
  const now = input.now ?? new Date();
  activeTimeZone = input.timeZone;
  const allowed = new Set((input.allowedSources ?? ["manual"]).map((s) => s.toLowerCase()));
  const contacts = input.familyContacts ?? [];
  const messages = input.familyMessages ?? [];

  const logsByResident = new Map<string, CareLogInput[]>();
  const excludedByResident = new Map<string, number>();
  for (const log of input.logs) {
    if (!log.resident_id) continue;
    const src = (log.entry_source ?? "manual").toLowerCase();
    if (!allowed.has(src)) {
      excludedByResident.set(log.resident_id, (excludedByResident.get(log.resident_id) ?? 0) + 1);
      continue;
    }
    const arr = logsByResident.get(log.resident_id) ?? [];
    arr.push(log);
    logsByResident.set(log.resident_id, arr);
  }

  // Night-time sensor summaries are analysed separately from care logs.
  const sensorByResident = new Map<string, CareLogInput[]>();
  for (const d of input.sensorDays ?? []) {
    if (!d.resident_id || !d.date) continue;
    const arr = sensorByResident.get(d.resident_id) ?? [];
    arr.push(sensorDayToLog(d));
    sensorByResident.set(d.resident_id, arr);
  }

  // Attention equity: how many observations each resident got this week.
  const last7 = new Map<string, number>();
  for (const r of input.residents) {
    const n = (logsByResident.get(r.id) ?? []).filter((l) => {
      const a = daysAgo(l.created_at, now);
      return a >= 0 && a < 7;
    }).length;
    last7.set(r.id, n);
  }
  const facilityMedian = median([...last7.values()]);

  const reports: ResidentReport[] = input.residents.map((r) => {
    const firstName = firstNameOf(r.full_name);
    const logs = logsByResident.get(r.id) ?? [];

    const sensorLogs = sensorByResident.get(r.id) ?? [];
    const signalList = METRICS.map((def) =>
      analyseSignal(def, def.source === "sensor" ? sensorLogs : logs, now, firstName)
    );
    const sig = Object.fromEntries(signalList.map((s) => [s.key, s])) as Record<MetricKey, SignalResult>;
    const flaggedSignals = signalList.filter((s) => s.severity !== null);

    const connection = analyseConnection(
      r.id,
      firstName,
      contacts,
      messages,
      now,
      sig.mood.severity !== null || sig.meals.severity !== null
    );

    // Attention
    const n7 = last7.get(r.id) ?? 0;
    const lastLog = logs.map((l) => l.created_at).sort().pop() ?? null;
    const hoursSince = lastLog ? (now.getTime() - new Date(lastLog).getTime()) / 3_600_000 : null;
    const ratio = facilityMedian > 0 ? n7 / facilityMedian : null;
    const underObserved = facilityMedian >= 3 && ratio !== null && ratio < 0.5;
    const notObservedToday = hoursSince === null || hoursSince > 24;
    const attention: AttentionResult = {
      logsLast7Days: n7,
      facilityMedianLast7Days: facilityMedian,
      ratioToMedian: ratio === null ? null : round(ratio, 2),
      hoursSinceLastLog: hoursSince === null ? null : round(hoursSince, 1),
      underObserved,
      notObservedToday,
      explanation: underObserved
        ? `${firstName} was observed ${n7} times this week against a home average of ${facilityMedian}. ` +
          `Quiet residents who don't ask for help are often the ones checked least.`
        : notObservedToday
        ? hoursSince === null
          ? `No care log has been recorded for ${firstName} yet.`
          : `No care log for ${firstName} in the last ${Math.round(hoursSince)} hours.`
        : null,
    };

    const patterns = detectPatterns(sig, connection, firstName);

    // Drift index: weighted sum of how far each signal moved in the worse
    // direction, squashed to 0–100. Every point can be traced to a signal.
    const load = signalList.reduce((acc, s) => {
      const def = METRICS.find((m) => m.key === s.key)!;
      if (s.severity === null || s.deviation === null) return acc;
      return acc + Math.min(Math.max(s.deviation, 0), 4) * def.weight;
    }, 0);
    const driftIndex = Math.round(100 * (1 - Math.exp(-load / 5)));

    const baselineDaysWithData = Math.max(...signalList.map((s) => s.baselineDays));
    let status: ResidentStatus;
    if (baselineDaysWithData < MIN_BASELINE_DAYS) status = "baseline";
    else if (driftIndex >= 50 || patterns.some((p) => p.severity === "severe")) status = "act";
    else if (driftIndex > 0 || patterns.length || underObserved) status = "watch";
    else status = "stable";

    const priorityScore =
      driftIndex +
      patterns.reduce((a, p) => a + 8 * SEVERITY_RANK[p.severity], 0) +
      (underObserved ? 15 : 0) +
      (notObservedToday ? 10 : 0) +
      (connection.lonelinessRisk ? 10 : connection.status === "none" ? 6 : connection.status === "gap" ? 4 : 0);

    const topActions: string[] = [];
    for (const p of patterns) for (const a of p.actions) if (topActions.length < 4) topActions.push(a);
    if (notObservedToday) topActions.unshift(`Visit ${firstName} now: not seen in the last 24 hours`);
    else if (underObserved) topActions.push(`Include ${firstName} in this shift's rounds: seen far less than others this week`);
    if (connection.status === "gap" && !patterns.some((p) => p.id === "withdrawal"))
      topActions.push("Send the family a call request");

    let summary: string;
    if (status === "baseline") {
      summary = `Still learning ${firstName}'s normal: ${baselineDaysWithData} of ${MIN_BASELINE_DAYS} baseline days logged.`;
    } else if (patterns.length) {
      summary = `${patterns[0].title}. ${flaggedSignals.length} signal${flaggedSignals.length === 1 ? "" : "s"} away from ${firstName}'s own baseline.`;
    } else if (flaggedSignals.length) {
      summary = flaggedSignals[0].explanation!;
    } else {
      summary = `All signals within ${firstName}'s usual range.`;
    }

    return {
      resident_id: r.id,
      name: r.full_name,
      firstName,
      room: r.room_number ?? null,
      status,
      driftIndex,
      priorityScore: Math.round(priorityScore),
      signals: signalList,
      flaggedSignals,
      patterns,
      connection,
      attention,
      summary,
      topActions,
      dataQuality: {
        logsUsed: logs.length,
        logsExcluded: excludedByResident.get(r.id) ?? 0,
        baselineDaysWithData,
      },
    };
  });

  reports.sort((a, b) => b.priorityScore - a.priorityScore || a.name.localeCompare(b.name));

  const count = (f: (r: ResidentReport) => boolean) => reports.filter(f).length;
  return {
    generatedAt: now.toISOString(),
    windowDays: WINDOW_DAYS,
    baselineRange: [BASELINE_START, BASELINE_END],
    recentRange: [0, RECENT_DAYS - 1],
    residents: reports,
    totals: {
      residents: reports.length,
      act: count((r) => r.status === "act"),
      watch: count((r) => r.status === "watch"),
      stable: count((r) => r.status === "stable"),
      buildingBaseline: count((r) => r.status === "baseline"),
      connectionGaps: count((r) => r.connection.status === "gap"),
      noFamily: count((r) => r.connection.status === "none"),
      underObserved: count((r) => r.attention.underObserved),
      notObservedToday: count((r) => r.attention.notObservedToday),
      logsUsed: reports.reduce((a, r) => a + r.dataQuality.logsUsed, 0),
      logsExcluded: reports.reduce((a, r) => a + r.dataQuality.logsExcluded, 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Bridge to the existing behavior_alerts table                        */
/* ------------------------------------------------------------------ */

export type BehaviorAlertInsert = {
  resident_id: string;
  resident_name: string;
  room: string | null;
  metric: string;
  baseline_mean: number | null;
  recent_mean: number | null;
  z_score: number | null;
  severity: Severity;
  message: string;
  resolved: boolean;
};

/** One row per flagged signal, in the shape the Behaviour Alerts page already reads. */
export function toBehaviorAlertRows(report: ResidentReport): BehaviorAlertInsert[] {
  return report.flaggedSignals.map((s) => ({
    resident_id: report.resident_id,
    resident_name: report.name,
    room: report.room,
    metric: s.key,
    baseline_mean: s.baselineMean,
    recent_mean: s.recentMean,
    z_score: s.deviation,
    severity: s.severity!,
    message: `[Early Warning] ${s.explanation}`,
    resolved: false,
  }));
}
