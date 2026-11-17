/**
 * Coarse "right now" status from the per-bed load-cell sensor.
 * Families see only "Resting in bed" / "Up and about" – never bathroom
 * visits or minute-by-minute movement.
 */

export type PresenceState = "in_bed" | "up";

export type Presence = {
  resident_id: string;
  state: PresenceState;
  since: string;
  source: "simulated" | "sensor";
  updated_at: string;
};

/** Older than this, we say "no recent update" instead of a stale status. */
export const PRESENCE_STALE_MS = 16 * 3600 * 1000;

export const PRESENCE_LABEL: Record<PresenceState, { family: string; staff: string }> = {
  in_bed: { family: "Resting in bed", staff: "In bed" },
  up: { family: "Up and about", staff: "Out of bed" },
};

export function isStale(p: Pick<Presence, "since" | "updated_at">, now = Date.now()) {
  const last = Math.max(new Date(p.since).getTime(), new Date(p.updated_at).getTime());
  return now - last > PRESENCE_STALE_MS;
}

export function sinceText(iso: string, timeZone?: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone });
}

export function durationText(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/**
 * Simulated daily routine (India time): night sleep 21:30–06:30,
 * afternoon rest 13:30–15:00, otherwise up. Returns the state and when
 * the current block started.
 */
export function routineState(now = new Date(), timeZone = "Asia/Kolkata"): { state: PresenceState; since: Date } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  const at = (h: number, m: number, dayOffset = 0) =>
    new Date(now.getTime() - (mins - (h * 60 + m)) * 60000 + dayOffset * 86400000);
  if (mins >= 21 * 60 + 30) return { state: "in_bed", since: at(21, 30) };
  if (mins < 6 * 60 + 30) return { state: "in_bed", since: at(21, 30, -1) };
  if (mins >= 15 * 60) return { state: "up", since: at(15, 0) };
  if (mins >= 13 * 60 + 30) return { state: "in_bed", since: at(13, 30) };
  return { state: "up", since: at(6, 30) };
}
