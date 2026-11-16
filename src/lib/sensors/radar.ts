/**
 * 60 GHz mmWave radar simulation (pure functions, testable).
 *
 * One ceiling-mounted 60 GHz radar per room can, without a camera and
 * without anything worn:
 *   - track presence, movement and the body's height above the floor;
 *   - detect a FALL: a fast drop in height followed by lying still on the
 *     floor (confirmed after a short window so it isn't a false alarm);
 *   - measure breathing rate and an estimate of heart rate from tiny chest
 *     movements while the person is still (e.g. asleep in bed).
 *
 * Everything here is SIMULATED; values are plausible, not measured.
 */

export type Posture = "empty" | "walking" | "sitting_chair" | "in_bed" | "sitting_floor" | "fallen";

export const POSTURE_LABEL: Record<Posture, string> = {
  empty: "Nobody there",
  walking: "Walking",
  sitting_chair: "Sitting on chair",
  in_bed: "Lying in bed",
  sitting_floor: "Sitting on the floor",
  fallen: "Lying on the floor",
};

/** Seconds the person must stay down after a fast drop before we alert. */
export const FALL_CONFIRM_MS = 10_000;

export type RadarReading = {
  presence: boolean;
  motion: "moving" | "still" | "none";
  /** Estimated height of the torso above the floor, metres. */
  bodyHeightM: number | null;
  breathing: number | null; // breaths / min
  heartRate: number | null; // beats / min (radar estimate, less precise)
};

const BASE: Record<Posture, { motion: RadarReading["motion"]; h: number | null; br: number | null; hr: number | null }> = {
  empty: { motion: "none", h: null, br: null, hr: null },
  walking: { motion: "moving", h: 1.05, br: 18, hr: 88 },
  sitting_chair: { motion: "still", h: 0.8, br: 16, hr: 76 },
  in_bed: { motion: "still", h: 0.55, br: 14.5, hr: 68 },
  sitting_floor: { motion: "still", h: 0.45, br: 16, hr: 78 },
  fallen: { motion: "still", h: 0.15, br: 23, hr: 104 },
};

/**
 * One radar frame. `rand` returns 0..1. Breathing and heart rate are only
 * reliable while the person is still: radar reads them from chest motion.
 */
export function radarReading(posture: Posture, rand: () => number = Math.random): RadarReading {
  const b = BASE[posture];
  const jitter = (spread: number) => (rand() - 0.5) * 2 * spread;
  return {
    presence: posture !== "empty",
    motion: b.motion,
    bodyHeightM: b.h === null ? null : Math.round((b.h + jitter(0.03)) * 100) / 100,
    breathing: b.br === null || b.motion === "moving" ? null : Math.round((b.br + jitter(1)) * 10) / 10,
    heartRate: b.hr === null || b.motion === "moving" ? null : Math.round(b.hr + jitter(4)),
  };
}

/**
 * How fast the body descended when changing posture (m/s). A fall drops the
 * torso about a metre in well under a second; sitting down on the floor (to
 * eat, pray or rest, common in Indian homes) is slow and controlled.
 */
export function descentSpeed(from: Posture, to: Posture): number {
  if (to === "fallen" && (from === "walking" || from === "sitting_chair")) return 2.2;
  if (to === "fallen") return 1.4;
  if (to === "sitting_floor") return 0.3;
  if (to === "in_bed" || to === "sitting_chair") return 0.4;
  return 0;
}

export const FALL_SPEED = 1.0; // m/s: faster than this and ending on the floor = suspected fall

export type FallState =
  | { phase: "idle" }
  | { phase: "confirming"; since: number }
  | { phase: "alerted"; at: number };

/**
 * Fall state machine.
 *  - fast drop to the floor        → "confirming" (start the timer)
 *  - stays down for FALL_CONFIRM_MS → "alerted"
 *  - gets up / leaves the floor     → back to "idle" (no alert)
 *  - slowly sitting on the floor never triggers.
 */
export function stepFall(state: FallState, prev: Posture, next: Posture, now: number): FallState {
  if (next !== "fallen") return { phase: "idle" };
  if (state.phase === "idle") {
    return prev !== next && descentSpeed(prev, next) >= FALL_SPEED ? { phase: "confirming", since: now } : state;
  }
  if (state.phase === "confirming" && now - state.since >= FALL_CONFIRM_MS) {
    return { phase: "alerted", at: now };
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Night-time breathing from the same radar                            */
/* ------------------------------------------------------------------ */

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

export function seededRandom(seed: number) {
  return mulberry32(seed);
}

/**
 * Average breathing rate per night (breaths/min), oldest first.
 * 'rising' climbs over the last 3 nights: the slow change that can
 * precede a chest infection or heart failure.
 */
export function simulateNightBreathing(trend: "normal" | "rising", nights = 14, seed = 7): number[] {
  const rand = mulberry32(seed);
  const base = 14 + rand() * 2;
  return Array.from({ length: nights }, (_, i) => {
    const fromEnd = nights - 1 - i;
    const rise = trend === "rising" && fromEnd < 3 ? (3 - fromEnd) * 2.4 : 0;
    return Math.round((base + rise + (rand() - 0.5) * 1.4) * 10) / 10;
  });
}

export type NightAnalysis = {
  baselineMean: number | null;
  recentMean: number | null;
  deviation: number | null;
  flagged: boolean;
  explanation: string;
};

/** Personal-baseline check, same idea as the Early Warning engine. */
export function analyseNightBreathing(values: number[]): NightAnalysis {
  if (values.length < 8) {
    return {
      baselineMean: null,
      recentMean: null,
      deviation: null,
      flagged: false,
      explanation: "Needs at least 8 nights of readings to learn this resident's normal.",
    };
  }
  const recent = values.slice(-3);
  const base = values.slice(0, -3);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const bMean = mean(base);
  const sd = Math.max(Math.sqrt(base.reduce((a, b) => a + (b - bMean) ** 2, 0) / (base.length - 1)), 1);
  const rMean = mean(recent);
  const dev = (rMean - bMean) / sd;
  const nightsAbove = recent.filter((v) => (v - bMean) / sd >= 1).length;
  const flagged = dev >= 2 && nightsAbove >= 2;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    baselineMean: r1(bMean),
    recentMean: r1(rMean),
    deviation: r1(dev),
    flagged,
    explanation: flagged
      ? `Breathing while asleep rose from a usual ${r1(bMean)}/min to ${r1(rMean)}/min over the last 3 nights ` +
        `(${r1(dev)} personal SD). This can be an early sign of a chest infection or heart failure, often days before daytime symptoms. Ask the nurse to review.`
      : `Breathing while asleep is within this resident's usual range (${r1(bMean)}/min, last 3 nights ${r1(rMean)}/min).`,
  };
}
