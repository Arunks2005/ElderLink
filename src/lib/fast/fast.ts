/**
 * BE-FAST stroke check: logic only, so it can be tested without a phone.
 *
 * A stroke can't be diagnosed by an app. This guides a carer through the
 * standard BE-FAST screen (Balance, Eyes, Face, Arms, Speech, Time) and helps
 * them act faster:
 *   - the arm test is sensor-assisted: the resident holds the phone with each
 *     outstretched arm for 10 s, and the phone measures how much it tilts as
 *     the arm sinks or turns (a "pronator drift");
 *   - the time since "last known well" is tracked, because clot-dissolving
 *     treatment is only possible within a few hours.
 * Every positive result says to call an ambulance (108 in India) now.
 */

/** accelerationIncludingGravity samples from DeviceMotion (m/s²). */
export type MotionSample = { t: number; x: number; y: number; z: number };

export const ARM_TEST_MS = 10_000;
/** Ignore the first moment while the arm settles into position. */
export const SETTLE_MS = 1_500;
/** Tilt change (degrees) that counts as drift for one arm. */
export const DRIFT_DEG = 12;
/** Minimum left/right difference so steady hands on both sides don't count. */
export const ASYMMETRY_DEG = 8;

function meanVector(samples: MotionSample[]) {
  const n = samples.length;
  const s = samples.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
  return { x: s.x / n, y: s.y / n, z: s.z / n };
}

function angleBetween(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const la = Math.hypot(a.x, a.y, a.z);
  const lb = Math.hypot(b.x, b.y, b.z);
  if (la === 0 || lb === 0) return 0;
  const c = Math.min(1, Math.max(-1, dot / (la * lb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * How far the phone tilted between the start (after settling) and the end
 * of the hold, in degrees. Null when there aren't enough samples (e.g. the
 * device has no motion sensor).
 */
export function tiltChangeDeg(samples: MotionSample[]): number | null {
  if (samples.length < 10) return null;
  const t0 = samples[0].t;
  const tEnd = samples[samples.length - 1].t;
  if (tEnd - t0 < SETTLE_MS + 3_000) return null;
  const start = samples.filter((s) => s.t - t0 >= SETTLE_MS && s.t - t0 < SETTLE_MS + 1_000);
  const end = samples.filter((s) => tEnd - s.t <= 1_500);
  if (start.length < 3 || end.length < 3) return null;
  return Math.round(angleBetween(meanVector(start), meanVector(end)) * 10) / 10;
}

export type ArmResult = {
  drift: boolean | null;
  weakerSide: "left" | "right" | null;
  explanation: string;
};

export function assessArms(leftDeg: number | null, rightDeg: number | null): ArmResult {
  if (leftDeg === null || rightDeg === null) {
    return { drift: null, weakerSide: null, explanation: "Arm test not measured. Watch both arms and answer yourself." };
  }
  const max = Math.max(leftDeg, rightDeg);
  const diff = Math.abs(leftDeg - rightDeg);
  const weaker = leftDeg > rightDeg ? "left" : "right";
  if (max >= DRIFT_DEG && diff >= ASYMMETRY_DEG) {
    return {
      drift: true,
      weakerSide: weaker,
      explanation: `The ${weaker} arm drifted ${max}° while the other moved ${Math.min(leftDeg, rightDeg)}°. One-sided arm drift is a stroke warning sign.`,
    };
  }
  if (max >= DRIFT_DEG) {
    return {
      drift: null,
      weakerSide: null,
      explanation: `Both arms moved a lot (${leftDeg}° / ${rightDeg}°). The phone may not have been held steady, so repeat the test or judge by eye.`,
    };
  }
  return {
    drift: false,
    weakerSide: null,
    explanation: `Both arms stayed steady (${leftDeg}° / ${rightDeg}°).`,
  };
}

/* ------------------------------------------------------------------ */

export type FastAnswers = {
  balance: boolean | null; // sudden loss of balance / coordination
  eyes: boolean | null; // sudden loss or blurring of vision
  face: boolean | null; // one side of the face droops when smiling
  arms: boolean | null; // one arm drifts down / is weak
  speech: boolean | null; // slurred, muddled or no speech
  lastKnownWell: string; // ISO time the resident was last seen normal
};

export type FastOutcome = {
  status: "positive" | "negative" | "incomplete";
  signs: string[];
  minutesSinceLastWell: number;
  headline: string;
  timeMessage: string | null;
  actions: string[];
};

const SIGN_LABELS: Record<keyof Omit<FastAnswers, "lastKnownWell">, string> = {
  balance: "Sudden loss of balance",
  eyes: "Sudden vision problem",
  face: "Face drooping on one side",
  arms: "Arm weakness / drift on one side",
  speech: "Slurred or muddled speech",
};

/** Clot-dissolving treatment is generally only possible within ~4.5 h. */
export const TREATMENT_WINDOW_MIN = 270;

export function evaluateFast(a: FastAnswers, now: Date = new Date()): FastOutcome {
  const keys = Object.keys(SIGN_LABELS) as (keyof typeof SIGN_LABELS)[];
  const signs = keys.filter((k) => a[k] === true).map((k) => SIGN_LABELS[k]);
  const unanswered = keys.filter((k) => a[k] === null);
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(a.lastKnownWell).getTime()) / 60_000));
  const lkw = new Date(a.lastKnownWell).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  if (signs.length > 0) {
    return {
      status: "positive",
      signs,
      minutesSinceLastWell: minutes,
      headline: "Possible stroke: call 108 (ambulance) now",
      timeMessage:
        minutes <= TREATMENT_WINDOW_MIN
          ? `Last known well ${formatDuration(minutes)} ago (${lkw}). Hospital treatment to dissolve a clot may still be possible, so every minute counts.`
          : `Last known well ${formatDuration(minutes)} ago (${lkw}). That is past the usual clot-dissolving window, but still call 108: other treatments and care help.`,
      actions: [
        "Call 108 and say \"suspected stroke\"",
        `Tell them the time last known well: ${lkw}`,
        "Stay with the resident. If drowsy, lay them on their side",
        "Give nothing by mouth (no food, water, tablets, and no aspirin)",
        "Get their medication list and medical notes ready for the ambulance",
      ],
    };
  }
  if (unanswered.length > 0) {
    return {
      status: "incomplete",
      signs: [],
      minutesSinceLastWell: minutes,
      headline: "Check not finished",
      timeMessage: null,
      actions: [`Still to check: ${unanswered.map((k) => SIGN_LABELS[k].toLowerCase()).join(", ")}`],
    };
  }
  return {
    status: "negative",
    signs: [],
    minutesSinceLastWell: minutes,
    headline: "No BE-FAST signs found",
    timeMessage: null,
    actions: [
      "Tell the nurse what prompted the check",
      "If anything is sudden or getting worse, repeat this check in 15 minutes",
      "If in doubt, call 108: it is always right to call",
    ],
  };
}

export function formatDuration(min: number) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
