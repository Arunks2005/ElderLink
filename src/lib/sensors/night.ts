/**
 * Shared-ward night simulation + sensor fusion (pure, testable).
 *
 * A real ward has one bed-exit mat per bed and ONE radar in the shared
 * bathroom. The mat knows *which bed* was left; the bathroom radar only
 * knows the bathroom is occupied, not by whom. ElderLink joins the two by
 * timing: each bathroom occupancy is credited to the earliest bed exit in
 * the few minutes before it, first come first served (the order people
 * queue for a shared bathroom).
 *
 * From that we get per-resident nightly summaries: sleep hours, bed exits,
 * bathroom visits and breathing rate. Everything here is SIMULATED.
 */

export type NightScenario = "normal" | "urinary" | "restless" | "breathing";

export const SCENARIO_LABEL: Record<NightScenario, string> = {
  normal: "Normal nights",
  urinary: "More bathroom trips",
  restless: "Restless nights",
  breathing: "Faster breathing asleep",
};

/** Minutes since 21:00 (so 0 = 9 pm, 600 = 7 am). */
export type Minutes = number;

export type BedNight = {
  bedId: string;
  bedtime: Minutes;
  wake: Minutes;
  outOfBed: { start: Minutes; end: Minutes; toBathroom: boolean }[];
  awakeInBedMin: number;
  breathing: number;
};

export type BathroomVisit = {
  start: Minutes;
  end: Minutes;
  /** Ground truth (simulation only; a real radar doesn't know this). */
  trueBedId: string;
  /** Who ElderLink credits it to by timing fusion. */
  attributedBedId: string | null;
};

export type NightSummary = {
  bedId: string;
  sleepHours: number;
  bedExits: number;
  bathroomVisits: number; // from fusion (what the system knows)
  breathing: number;
};

export type WardNight = {
  beds: BedNight[];
  bathroom: BathroomVisit[];
  summaries: NightSummary[];
  attributionAccuracy: number | null; // share of visits credited to the right bed
};

/** Max minutes between leaving bed and the bathroom radar seeing someone. */
export const ATTRIBUTION_WINDOW_MIN = 6;

export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rand: () => number, lo: number, hi: number) => lo + rand() * (hi - lo);

/**
 * Credit each bathroom occupancy to a bed exit: the earliest unclaimed exit
 * that happened within ATTRIBUTION_WINDOW_MIN minutes before the occupancy
 * started (first come, first served). Unmatched occupancies stay null.
 */
export function attributeBathroomVisits(
  exits: { bedId: string; t: Minutes }[],
  occupancies: { start: Minutes }[]
): (string | null)[] {
  const pending = [...exits].sort((a, b) => a.t - b.t).map((e) => ({ ...e, used: false }));
  return occupancies.map((o) => {
    const match = pending.find((e) => !e.used && e.t <= o.start && o.start - e.t <= ATTRIBUTION_WINDOW_MIN);
    if (!match) return null;
    match.used = true;
    return match.bedId;
  });
}

/**
 * One simulated night for a ward. `active` = this is one of the last 3
 * nights, when a bed's scenario shows its change.
 */
export function simulateWardNight(
  beds: { bedId: string; scenario: NightScenario }[],
  active: boolean,
  rand: () => number
): WardNight {
  const bedNights: BedNight[] = [];
  const trips: { bedId: string; exit: Minutes; durationMin: number }[] = [];

  for (const { bedId, scenario } of beds) {
    const s = active ? scenario : "normal";
    const bedtime = Math.round(between(rand, 30, 75)); // 21:30–22:15
    const wake = Math.round(between(rand, 540, 585)); // 06:00–06:45
    let exits: number;
    let bathroomShare: number;
    let awake: number;
    let breathing = between(rand, 14, 16.5);
    if (s === "urinary") {
      exits = 3 + Math.floor(rand() * 3);
      bathroomShare = 1;
      awake = between(rand, 20, 40);
    } else if (s === "restless") {
      // Up more often, mostly NOT to the bathroom, and lying awake longer.
      exits = 3 + Math.floor(rand() * 3);
      bathroomShare = 0.3;
      awake = between(rand, 90, 140);
    } else {
      exits = rand() < 0.25 ? 0 : rand() < 0.75 ? 1 : 2;
      bathroomShare = 0.85;
      awake = between(rand, 15, 35);
      if (s === "breathing") breathing += between(rand, 4.5, 7);
    }

    const outOfBed: BedNight["outOfBed"] = [];
    for (let i = 0; i < exits; i++) {
      const exit = Math.round(bedtime + 30 + ((wake - bedtime - 60) * (i + rand() * 0.8)) / exits);
      const toBathroom = rand() < bathroomShare;
      const dur = toBathroom ? between(rand, 5, 10) : between(rand, 6, 18);
      outOfBed.push({ start: exit, end: Math.round(exit + dur), toBathroom });
      if (toBathroom) trips.push({ bedId, exit, durationMin: dur });
    }
    bedNights.push({ bedId, bedtime, wake, outOfBed, awakeInBedMin: Math.round(awake), breathing: Math.round(breathing * 10) / 10 });
  }

  // Shared bathroom: one person at a time, queue if busy.
  trips.sort((a, b) => a.exit - b.exit);
  const bathroom: BathroomVisit[] = [];
  let freeAt = 0;
  for (const tr of trips) {
    const arrive = tr.exit + between(rand, 0.5, 2);
    const start = Math.max(arrive, freeAt);
    const end = start + between(rand, 3, 7);
    freeAt = end;
    bathroom.push({ start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, trueBedId: tr.bedId, attributedBedId: null });
  }

  // Sensor fusion: what ElderLink actually knows.
  const exitsSeen = bedNights.flatMap((b) => b.outOfBed.map((o) => ({ bedId: b.bedId, t: o.start })));
  const credited = attributeBathroomVisits(exitsSeen, bathroom);
  bathroom.forEach((v, i) => (v.attributedBedId = credited[i]));
  const correct = bathroom.filter((v) => v.attributedBedId === v.trueBedId).length;

  const summaries: NightSummary[] = bedNights.map((b) => {
    const out = b.outOfBed.reduce((a, o) => a + (o.end - o.start), 0);
    const sleepMin = Math.max(0, b.wake - b.bedtime - out - b.awakeInBedMin);
    return {
      bedId: b.bedId,
      sleepHours: Math.round((sleepMin / 60) * 10) / 10,
      bedExits: b.outOfBed.length,
      bathroomVisits: bathroom.filter((v) => v.attributedBedId === b.bedId).length,
      breathing: b.breathing,
    };
  });

  return {
    beds: bedNights,
    bathroom,
    summaries,
    attributionAccuracy: bathroom.length ? Math.round((correct / bathroom.length) * 100) : null,
  };
}

/** HH:MM for minutes since 21:00. */
export function clockOf(m: Minutes) {
  const total = (21 * 60 + Math.round(m)) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
