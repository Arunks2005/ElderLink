/**
 * SIMULATED demo cohort for the Early Warning engine.
 *
 * Everything in this file is synthetic: the residents are fictional, and the
 * data is generated in memory and never written to the database. It exists so
 * the engine can be shown and tested even when the live database has fewer
 * than 5 days of history per resident.
 *
 * Each resident has a scripted scenario so the demo shows what the engine
 * catches AND what it deliberately ignores (normal day-to-day noise).
 */

import type {
  CareLogInput,
  FamilyContactInput,
  FamilyMessageInput,
  ResidentInput,
} from "./engine";

export const DEMO_LABEL = "SIMULATED DEMO DATA — fictional residents, generated in memory, never saved";

export type DemoScenario = {
  resident: ResidentInput;
  story: string;
  expected: string;
};

/** Deterministic PRNG so the demo looks the same every time it runs. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Probs = Record<string, number>;

function pick(rand: () => number, probs: Probs): string {
  const r = rand();
  let acc = 0;
  const entries = Object.entries(probs);
  for (const [k, p] of entries) {
    acc += p;
    if (r <= acc) return k;
  }
  return entries[entries.length - 1][0];
}

type DayProfile = {
  meals: Probs;
  fluids: Probs;
  mood: Probs;
  medication: Probs;
  pain?: [number, number]; // [mean, jitter]
  temp: [number, number];
  hr: [number, number];
};

const NORMAL: DayProfile = {
  meals: { "Ate Fully": 0.75, Partially: 0.22, Refused: 0.03 },
  fluids: { Good: 0.85, Low: 0.15, None: 0 },
  mood: { Happy: 0.45, Calm: 0.5, Agitated: 0.04, Confused: 0.01 },
  medication: { Given: 0.97, Refused: 0.02, Missed: 0.01 },
  temp: [97.8, 0.3],
  hr: [74, 4],
};

const RESIDENTS: DemoScenario[] = [
  {
    resident: { id: "demo-r1", full_name: "Kamala Iyer", room_number: "101" },
    story: "Drinking less for 3 days, now confused at times and running slightly warm.",
    expected: "Act today: low fluids with new confusion (screen for dehydration / UTI).",
  },
  {
    resident: { id: "demo-r2", full_name: "Ramesh Gupta", room_number: "104" },
    story: "Son used to message every few days, but nothing for 19 days. Eating less and mood has dropped.",
    expected: "Watch or act: eating less, low mood, connection gap. Send a family call request.",
  },
  {
    resident: { id: "demo-r3", full_name: "Fatima Sheikh", room_number: "107" },
    story: "Stable. Has the odd 'Partially' meal and one agitated day, which is normal for her.",
    expected: "Stable: ordinary noise must NOT raise a flag.",
  },
  {
    resident: { id: "demo-r4", full_name: "Joseph D'Souza", room_number: "110" },
    story: "Started refusing his evening tablets 3 days ago and is more agitated.",
    expected: "Medication being refused more often: ask why and inform the nurse.",
  },
  {
    resident: { id: "demo-r5", full_name: "Lakshmi Narayan", room_number: "112" },
    story: "Quiet, never presses the call bell. No family registered. Logged about once a day while others get about four logs.",
    expected: "Seen far less than others, and no family. Should not be invisible in rounds.",
  },
  {
    resident: { id: "demo-r6", full_name: "Harbans Singh", room_number: "115" },
    story: "Chronic knee pain, usually about 3/10. Pain has been 6–7/10 for the last 3 days.",
    expected: "Pain higher than usual: check for an unreported fall or new problem.",
  },
];

export const DEMO_SCENARIOS = RESIDENTS;

function profileFor(id: string, ago: number): DayProfile {
  const p: DayProfile = JSON.parse(JSON.stringify(NORMAL));
  switch (id) {
    case "demo-r1":
      if (ago <= 2) {
        p.fluids = { Good: 0.1, Low: 0.6, None: 0.3 };
        p.mood = { Happy: 0.05, Calm: 0.35, Agitated: 0.15, Confused: 0.45 };
        p.meals = { "Ate Fully": 0.5, Partially: 0.4, Refused: 0.1 };
        p.temp = [99.3, 0.3];
        p.hr = [86, 4];
      }
      break;
    case "demo-r2":
      if (ago <= 4) {
        p.meals = { "Ate Fully": 0.15, Partially: 0.5, Refused: 0.35 };
        p.mood = { Happy: 0.0, Calm: 0.55, Agitated: 0.45, Confused: 0 };
      }
      break;
    case "demo-r3":
      p.meals = { "Ate Fully": 0.65, Partially: 0.32, Refused: 0.03 };
      p.mood = { Happy: 0.5, Calm: 0.4, Agitated: 0.1, Confused: 0 };
      break;
    case "demo-r4":
      if (ago <= 2) {
        p.medication = { Given: 0.45, Refused: 0.5, Missed: 0.05 };
        p.mood = { Happy: 0.1, Calm: 0.5, Agitated: 0.4, Confused: 0 };
      }
      break;
    case "demo-r6":
      p.pain = ago <= 2 ? [6.5, 0.7] : [3, 0.8];
      break;
  }
  return p;
}

function logsPerDay(id: string) {
  return id === "demo-r5" ? 1 : 4;
}

export function buildDemoCohort(now: Date = new Date()) {
  const rand = mulberry32(20261116);
  const logs: CareLogInput[] = [];

  for (const { resident } of RESIDENTS) {
    for (let ago = 27; ago >= 0; ago--) {
      const perDay = logsPerDay(resident.id);
      for (let i = 0; i < perDay; i++) {
        const p = profileFor(resident.id, ago);
        // spread logs over the day: 08:00, 12:00, 16:00, 20:00
        const ts = new Date(now);
        ts.setDate(ts.getDate() - ago);
        ts.setHours(8 + i * 4, Math.floor(rand() * 50), 0, 0);
        if (ts.getTime() > now.getTime()) continue; // no logs from the future
        const vitals = i === 0; // vitals recorded at the morning round
        logs.push({
          resident_id: resident.id,
          created_at: ts.toISOString(),
          meals: pick(rand, p.meals),
          fluids: pick(rand, p.fluids),
          mood: pick(rand, p.mood),
          medication: pick(rand, p.medication),
          pain_scale: p.pain
            ? Math.max(0, Math.min(10, Math.round(p.pain[0] + (rand() - 0.5) * 2 * p.pain[1])))
            : null,
          temperature: vitals ? Math.round((p.temp[0] + (rand() - 0.5) * 2 * p.temp[1]) * 10) / 10 : null,
          heart_rate: vitals ? Math.round(p.hr[0] + (rand() - 0.5) * 2 * p.hr[1]) : null,
          entry_source: "manual",
        });
      }
    }
  }

  const familyContacts: FamilyContactInput[] = [
    { resident_id: "demo-r1", full_name: "Priya Iyer", relationship: "Daughter", phone: null, is_primary: true },
    { resident_id: "demo-r2", full_name: "Anil Gupta", relationship: "Son", phone: null, is_primary: true },
    { resident_id: "demo-r3", full_name: "Imran Sheikh", relationship: "Son", phone: null, is_primary: true },
    { resident_id: "demo-r4", full_name: "Maria D'Souza", relationship: "Niece", phone: null, is_primary: true },
    // demo-r5 (Lakshmi) deliberately has no family contact
    { resident_id: "demo-r6", full_name: "Gurpreet Kaur", relationship: "Daughter", phone: null, is_primary: true },
  ];

  const msg = (resident_id: string, ago: number): FamilyMessageInput => {
    const d = new Date(now);
    d.setDate(d.getDate() - ago);
    d.setHours(19, 0, 0, 0);
    return { resident_id, created_at: d.toISOString(), sender_role: "family" };
  };

  const familyMessages: FamilyMessageInput[] = [
    msg("demo-r1", 1),
    msg("demo-r1", 4),
    // Ramesh: regular contact that stopped 19 days ago
    msg("demo-r2", 19),
    msg("demo-r2", 23),
    msg("demo-r2", 26),
    msg("demo-r3", 0),
    msg("demo-r3", 2),
    msg("demo-r3", 5),
    msg("demo-r4", 3),
    msg("demo-r6", 2),
  ];

  return {
    residents: RESIDENTS.map((s) => s.resident),
    logs,
    familyContacts,
    familyMessages,
  };
}
