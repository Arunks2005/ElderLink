/**
 * Sensor simulation + interpretation (pure functions, testable).
 *
 * Everything produced here is SIMULATED and stored with
 * source = 'simulated_sensor'. The point is to show how real low-cost
 * sensors would plug into ElderLink: a ceiling mmWave radar (falls),
 * a bed mat (night bed-exits), a wearable (pulse + SpO2) and a bedside
 * radar measuring breathing rate during sleep.
 */

export type SensorKind = "mmwave_radar" | "bed_mat" | "wearable" | "sleep_radar";

export const SENSOR_INFO: Record<SensorKind, { name: string; cost: string; detects: string }> = {
  mmwave_radar: {
    name: "Ceiling mmWave radar (60 GHz)",
    cost: "≈ ₹2,500–4,000 per room",
    detects: "A person falling and staying on the floor. No camera, nothing to wear, works in bathrooms.",
  },
  bed_mat: {
    name: "Bed pressure mat",
    cost: "≈ ₹500–1,500",
    detects: "Getting out of bed at night and not returning (a common moment for falls).",
  },
  wearable: {
    name: "Wrist wearable (pulse + SpO2)",
    cost: "≈ ₹300 sensor (MAX30102) or a basic smartwatch",
    detects: "Heart rate and blood-oxygen readings outside safe limits.",
  },
  sleep_radar: {
    name: "Bedside sleep radar",
    cost: "≈ ₹3,000–4,000",
    detects: "Breathing rate while asleep, compared night by night with the resident's own normal.",
  },
};

/* ------------------------------------------------------------------ */
/* Wearable vitals                                                     */
/* ------------------------------------------------------------------ */

export type VitalsVerdict = {
  level: "ok" | "watch" | "alert";
  message: string;
  actions: string[];
};

/** Simple, conservative rules for an older adult at rest (screening, not diagnosis). */
export function interpretVitals(hr: number, spo2: number): VitalsVerdict {
  const problems: string[] = [];
  let level: VitalsVerdict["level"] = "ok";
  const raise = (l: VitalsVerdict["level"]) => {
    if (l === "alert" || (l === "watch" && level === "ok")) level = l;
  };

  if (spo2 < 90) {
    problems.push(`oxygen ${spo2}% (low)`);
    raise("alert");
  } else if (spo2 < 94) {
    problems.push(`oxygen ${spo2}% (below normal)`);
    raise("watch");
  }
  if (hr >= 130 || hr < 40) {
    problems.push(`heart rate ${hr}/min (${hr < 40 ? "very slow" : "very fast"})`);
    raise("alert");
  } else if (hr >= 110 || hr < 50) {
    problems.push(`heart rate ${hr}/min (${hr < 50 ? "slow" : "fast"})`);
    raise("watch");
  }

  if (level === "ok") {
    return { level, message: `Heart rate ${hr}/min and oxygen ${spo2}% are within the usual range.`, actions: [] };
  }
  return {
    level,
    message: `Wearable reading: ${problems.join(", ")}.`,
    actions:
      level === "alert"
        ? [
            "Go to the resident now and check them in person",
            "Recheck with a pulse oximeter. A loose wearable often gives false readings",
            "If they have chest pain, breathlessness, sweating or sudden confusion, call 108",
            "Inform the nurse in charge",
          ]
        : ["Recheck in 15 minutes", "Note any symptoms in the care log", "Inform the nurse if it persists"],
  };
}

/* ------------------------------------------------------------------ */
/* Night breathing rate (sleep radar)                                  */
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

/**
 * Average breathing rate per night (breaths/min), oldest first.
 * 'rising' = normal for most nights, then climbing over the last 3 nights:
 * the kind of slow change that can precede a chest infection or heart failure.
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
  baselineSd: number | null;
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
      baselineSd: null,
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
    baselineSd: r1(sd),
    recentMean: r1(rMean),
    deviation: r1(dev),
    flagged,
    explanation: flagged
      ? `Breathing while asleep rose from a usual ${r1(bMean)}/min to ${r1(rMean)}/min over the last 3 nights ` +
        `(${r1(dev)} personal SD). This can be an early sign of a chest infection or heart failure, often days before daytime symptoms. Ask the nurse to review.`
      : `Breathing while asleep is within this resident's usual range (${r1(bMean)}/min, last 3 nights ${r1(rMean)}/min).`,
  };
}
