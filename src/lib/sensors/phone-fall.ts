/**
 * Phone-as-resident fall detector (accelerometer, in g).
 *
 * A real drop of a phone (or a person carrying it) has three phases:
 *   1. free fall  – total acceleration near 0 g for a short moment
 *   2. impact     – a sharp spike well above 1 g soon after
 *   3. stillness  – ~1 g and steady: lying on the floor, not getting up
 * A hard shake has no free fall and no stillness, so it does not trigger.
 * A very hard impact followed by stillness also counts (phone in a pocket
 * often doesn't see a clean free fall).
 */

export const FREE_FALL_G = 0.45;
export const FREE_FALL_MIN_MS = 60;
export const IMPACT_G = 2.0;
export const HARD_IMPACT_G = 3.0;
export const IMPACT_WINDOW_MS = 1000;
export const STILL_MS = 1500;
export const STILL_TOLERANCE_G = 0.25;

export type FallPhase = "idle" | "freefall" | "impact" | "fall";

export type FallDetector = {
  phase: FallPhase;
  freeFallSince: number | null;
  freeFallEndedAt: number | null;
  impactAt: number | null;
  peakG: number;
  stillSince: number | null;
};

export function newDetector(): FallDetector {
  return { phase: "idle", freeFallSince: null, freeFallEndedAt: null, impactAt: null, peakG: 0, stillSince: null };
}

/** Feed one reading (magnitude in g, time in ms). Returns the new state. */
export function step(d: FallDetector, g: number, t: number): FallDetector {
  const s = { ...d };
  switch (s.phase) {
    case "fall":
      return s;
    case "idle":
    case "freefall": {
      if (g < FREE_FALL_G) {
        s.freeFallSince ??= t;
        if (t - s.freeFallSince >= FREE_FALL_MIN_MS) s.phase = "freefall";
        return s;
      }
      const hadFreeFall = s.phase === "freefall";
      if (hadFreeFall) s.freeFallEndedAt = t;
      s.freeFallSince = null;
      const recentFreeFall = s.freeFallEndedAt != null && t - s.freeFallEndedAt <= IMPACT_WINDOW_MS;
      if ((g >= IMPACT_G && recentFreeFall) || g >= HARD_IMPACT_G) {
        s.phase = "impact";
        s.impactAt = t;
        s.peakG = g;
        s.stillSince = null;
        return s;
      }
      // Free fall ended without an impact: keep waiting until the window passes.
      if (s.phase === "freefall" && !recentFreeFall) s.phase = "idle";
      return s;
    }
    case "impact": {
      s.peakG = Math.max(s.peakG, g);
      if (Math.abs(g - 1) <= STILL_TOLERANCE_G) {
        s.stillSince ??= t;
        if (t - s.stillSince >= STILL_MS) s.phase = "fall";
      } else {
        s.stillSince = null;
        // Still moving a lot 4 s after the impact: they got up / phone picked up.
        if (s.impactAt != null && t - s.impactAt > 4000) return newDetector();
      }
      return s;
    }
  }
}
