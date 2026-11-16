"use client";

/**
 * Sensor Lab: a live, SIMULATED 60 GHz mmWave radar in one resident's room.
 *
 * Pick what the resident is doing; the "radar" streams a reading every
 * second (presence, motion, body height, breathing, heart rate). A fast drop
 * to the floor starts a 10-second confirmation; if they stay down, a real
 * fall_events row is created and the alert appears live on the staff
 * dashboard. Sitting down slowly on the floor (to eat or pray) is not a fall.
 *
 * All data is marked source = 'simulated_sensor' / device SIM-RADAR60-*.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Armchair,
  DoorOpen,
  Footprints,
  FlaskConical,
  HeartPulse,
  Loader2,
  PersonStanding,
  Radar,
  Trash2,
  Wind,
  CircleDot,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  analyseNightBreathing,
  descentSpeed,
  FALL_CONFIRM_MS,
  POSTURE_LABEL,
  radarReading,
  simulateNightBreathing,
  stepFall,
  type FallState,
  type Posture,
  type RadarReading,
} from "@/lib/sensors/radar";

type Resident = { id: string; full_name: string; room_number: string | null };
type SensorEvent = {
  id: string;
  created_at: string;
  event_type: string;
  status: string | null;
  value: number | null;
  unit: string | null;
  resident_id: string | null;
};

const SCENARIOS: { posture: Posture; label: string; icon: React.ComponentType<{ className?: string }>; danger?: boolean }[] = [
  { posture: "walking", label: "Walking", icon: Footprints },
  { posture: "sitting_chair", label: "Sits on chair", icon: Armchair },
  { posture: "in_bed", label: "Lies in bed", icon: BedDouble },
  { posture: "sitting_floor", label: "Sits on floor (meal / prayer)", icon: PersonStanding },
  { posture: "fallen", label: "Falls", icon: AlertTriangle, danger: true },
  { posture: "empty", label: "Leaves room", icon: DoorOpen },
];

const STATUS_CLS: Record<string, string> = {
  alert: "bg-red-50 text-red-700 border-red-200",
  watch: "bg-amber-50 text-amber-700 border-amber-200",
  info: "bg-slate-50 text-slate-600 border-slate-200",
};

/* ------------------------------------------------------------------ */
/* Top-down room view                                                  */
/* ------------------------------------------------------------------ */

function RoomView({ posture, fall }: { posture: Posture; fall: FallState["phase"] }) {
  const person = "#0f766e";
  const danger = "#dc2626";
  return (
    <svg viewBox="0 0 400 280" className="w-full h-auto" role="img" aria-label={`Room view: ${POSTURE_LABEL[posture]}`}>
      {/* floor + walls */}
      <rect x="4" y="4" width="392" height="272" rx="14" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="3" />
      {/* bed */}
      <rect x="22" y="22" width="130" height="78" rx="10" fill="#e2e8f0" stroke="#94a3b8" />
      <rect x="28" y="28" width="30" height="66" rx="6" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x="88" y="114" fontSize="10" fill="#64748b" textAnchor="middle">bed</text>
      {/* chair */}
      <rect x="296" y="170" width="44" height="44" rx="8" fill="#e2e8f0" stroke="#94a3b8" />
      <text x="318" y="228" fontSize="10" fill="#64748b" textAnchor="middle">chair</text>
      {/* floor mat */}
      <rect x="150" y="196" width="100" height="50" rx="8" fill="#fef3c7" stroke="#fcd34d" />
      <text x="200" y="258" fontSize="10" fill="#92400e" textAnchor="middle">floor mat</text>
      {/* bathroom door */}
      <rect x="392" y="40" width="8" height="60" fill="#94a3b8" />
      <text x="372" y="34" fontSize="10" fill="#64748b" textAnchor="middle">bathroom</text>
      <rect x="0" y="180" width="8" height="60" fill="#94a3b8" />
      <text x="34" y="176" fontSize="10" fill="#64748b" textAnchor="middle">door</text>

      {/* radar coverage + pulses */}
      <circle cx="200" cy="140" r="150" fill="#6366f1" opacity="0.05" />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx="200" cy="140" r="10" fill="none" stroke="#6366f1" strokeWidth="1.5" opacity="0.5">
          <animate attributeName="r" from="10" to="150" dur="3s" begin={`${i}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" from="0.5" to="0" dur="3s" begin={`${i}s`} repeatCount="indefinite" />
        </circle>
      ))}
      <rect x="188" y="128" width="24" height="24" rx="6" fill="#4f46e5" />
      <text x="200" y="144" fontSize="9" fill="white" textAnchor="middle" fontWeight="bold">60G</text>

      {/* person */}
      {posture === "walking" && (
        <g>
          <circle r="11" fill={person} />
          <circle r="16" fill="none" stroke={person} opacity="0.3" />
          <animateMotion dur="9s" repeatCount="indefinite" path="M90,170 C140,120 260,110 300,140 S240,240 150,200 S60,200 90,170 Z" />
        </g>
      )}
      {posture === "sitting_chair" && <circle cx="318" cy="192" r="12" fill={person} />}
      {posture === "in_bed" && <ellipse cx="96" cy="61" rx="44" ry="15" fill={person} opacity="0.85" />}
      {posture === "sitting_floor" && <circle cx="200" cy="221" r="13" fill={person} />}
      {posture === "fallen" && (
        <g>
          <ellipse cx="340" cy="108" rx="40" ry="13" fill={fall === "alerted" ? danger : "#f97316"} transform="rotate(-18 340 108)" />
          <circle cx="340" cy="108" r="30" fill="none" stroke={danger} strokeWidth="2">
            <animate attributeName="r" from="20" to="48" dur="1.2s" repeatCount="indefinite" />
            <animate attributeName="opacity" from="0.8" to="0" dur="1.2s" repeatCount="indefinite" />
          </circle>
        </g>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Live vitals                                                          */
/* ------------------------------------------------------------------ */

function BreathWave({ rate }: { rate: number | null }) {
  const period = 80; // px per breath
  const W = 240;
  let d = "";
  for (let x = 0; x <= W + period; x += 4) {
    const y = rate ? 20 - 12 * Math.sin((x / period) * Math.PI * 2) : 20;
    d += `${x === 0 ? "M" : "L"}${x},${y.toFixed(1)} `;
  }
  return (
    <svg viewBox={`0 0 ${W} 40`} className="w-full h-10 overflow-hidden" aria-hidden>
      <g style={rate ? { animation: `sl-breath ${(60 / rate).toFixed(2)}s linear infinite` } : undefined}>
        <path d={d} fill="none" stroke={rate ? "#0f766e" : "#cbd5e1"} strokeWidth="2.5" />
      </g>
      <style>{`@keyframes sl-breath { from { transform: translateX(0) } to { transform: translateX(-${period}px) } } @media (prefers-reduced-motion: reduce) { g { animation: none !important } }`}</style>
    </svg>
  );
}

function Tile({ label, value, sub, tone = "slate" }: { label: string; value: string; sub?: string; tone?: "slate" | "red" | "amber" | "teal" }) {
  const cls = {
    slate: "text-slate-900",
    red: "text-red-600",
    amber: "text-amber-600",
    teal: "text-teal-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`text-lg font-black leading-tight ${cls}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

function Spark({ values, flagged }: { values: number[]; flagged: boolean }) {
  if (values.length < 2) return null;
  const W = 260;
  const H = 54;
  const lo = Math.min(...values) - 1;
  const hi = Math.max(...values) + 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" role="img" aria-label="Breathing rate per night">
      <rect x={x(values.length - 3) - 4} y={0} width={W - x(values.length - 3) + 4} height={H} fill="#f1f5f9" />
      <path d={d} fill="none" stroke={flagged ? "#dc2626" : "#0f766e"} strokeWidth={2} strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.2} fill={flagged && i >= values.length - 3 ? "#dc2626" : "#0f766e"} />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ */

export default function SensorLabPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentId, setResidentId] = useState("");
  const [events, setEvents] = useState<SensorEvent[]>([]);
  const [posture, setPosture] = useState<Posture>("in_bed");
  const [fall, setFall] = useState<FallState>({ phase: "idle" });
  const [reading, setReading] = useState<RadarReading | null>(null);
  const [now, setNow] = useState(0);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "warn" | "alert" | "err" } | null>(null);
  const [trend, setTrend] = useState<"normal" | "rising">("rising");
  const [nights, setNights] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const postureRef = useRef<Posture>("in_bed");
  const fallRef = useRef<FallState>({ phase: "idle" });
  const residentRef = useRef<Resident | null>(null);

  const resident = residents.find((r) => r.id === residentId) ?? null;
  const room = resident?.room_number || "Unassigned";

  useEffect(() => {
    residentRef.current = resident;
  }, [resident]);

  const loadEvents = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("sensor_events")
      .select("id, created_at, event_type, status, value, unit, resident_id")
      .eq("sensor_type", "mmwave_radar")
      .order("created_at", { ascending: false })
      .limit(15);
    setEvents((data as SensorEvent[]) ?? []);
  }, []);

  const logEvent = useCallback(async (row: Record<string, unknown>) => {
    const r = residentRef.current;
    if (!r) return;
    const supabase = createClient();
    await supabase.from("sensor_events").insert({
      source: "simulated_sensor",
      sensor_type: "mmwave_radar",
      device_id: `SIM-RADAR60-${r.room_number || "NA"}`,
      resident_id: r.id,
      room: r.room_number || "Unassigned",
      ...row,
    });
  }, []);

  const raiseFallAlert = useCallback(async () => {
    const r = residentRef.current;
    if (!r) return;
    const supabase = createClient();
    const { error } = await supabase.from("fall_events").insert({
      device_id: `SIM-RADAR60-${r.room_number || "NA"}`,
      resident_id: r.id,
      status: "unresolved",
      z_drop: 2.2,
      doppler_spike: 1.8,
    });
    await logEvent({ event_type: "fall_confirmed", status: "alert", payload: { still_on_floor_s: FALL_CONFIRM_MS / 1000 } });
    setMsg(
      error
        ? { text: `Fall confirmed, but the alert could not be saved: ${error.message}`, tone: "err" }
        : {
            text: `FALL CONFIRMED: ${r.full_name} has been on the floor for ${FALL_CONFIRM_MS / 1000} s. The alert is now live on the staff dashboard.`,
            tone: "alert",
          }
    );
  }, [logEvent]);

  // Auth, residents, event feed, realtime and the 1-second radar stream.
  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      const { data: rows } = await supabase
        .from("residents")
        .select("id, full_name, room_number")
        .eq("status", "active")
        .order("full_name");
      if (cancelled) return;
      setResidents((rows as Resident[]) ?? []);
      setResidentId((rows as Resident[] | null)?.[0]?.id ?? "");
      await loadEvents();
      setReady(true);

      channel = supabase
        .channel("sensor-lab-radar")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sensor_events" }, (p) => {
          const e = p.new as SensorEvent & { sensor_type?: string };
          if (e.sensor_type === "mmwave_radar") setEvents((prev) => [e, ...prev].slice(0, 15));
        })
        .subscribe();

      timer = setInterval(() => {
        const t = Date.now();
        const p = postureRef.current;
        setNow(t);
        setReading(radarReading(p));
        const next = stepFall(fallRef.current, p, p, t);
        if (next.phase === "alerted" && fallRef.current.phase !== "alerted") void raiseFallAlert();
        fallRef.current = next;
        setFall(next);
      }, 1000);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, loadEvents, raiseFallAlert]);

  /** `at` = wall-clock ms of the click (event time, so it matches the radar stream clock). */
  const choose = (next: Posture, at: number) => {
    const prev = postureRef.current;
    if (prev === next) return;
    const t = at;
    const f = stepFall(fallRef.current, prev, next, t);
    const speed = descentSpeed(prev, next);
    postureRef.current = next;
    fallRef.current = f;
    setPosture(next);
    setFall(f);
    setReading(radarReading(next));
    setNow(t);
    if (next === "fallen" && f.phase === "confirming") {
      setMsg({ text: `Fast drop detected (${speed} m/s). Confirming: alert if still on the floor in ${FALL_CONFIRM_MS / 1000} s…`, tone: "warn" });
    } else if (next === "sitting_floor") {
      setMsg({ text: `Slow, controlled descent (${speed} m/s) to the floor mat: recognised as sitting, not a fall.`, tone: "ok" });
    } else if (prev === "fallen") {
      setMsg({ text: "Resident is up again. Fall check cancelled.", tone: "ok" });
    } else {
      setMsg(null);
    }
    void logEvent({
      event_type: `posture:${next}`,
      status: next === "fallen" ? "watch" : "info",
      value: speed || null,
      unit: speed ? "m/s" : null,
      payload: { from: prev, to: next },
    });
  };

  const simulateNights = async () => {
    if (!resident) return;
    setBusy(true);
    const values = simulateNightBreathing(trend, 14, Math.floor(Math.random() * 1000));
    const analysis = analyseNightBreathing(values);
    const supabase = createClient();
    const rows = values.map((v, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (values.length - 1 - i));
      d.setHours(2, 0, 0, 0);
      return {
        source: "simulated_sensor",
        sensor_type: "mmwave_radar",
        device_id: `SIM-RADAR60-${room}`,
        resident_id: resident.id,
        room,
        event_type: "sleep_breathing",
        value: v,
        unit: "breaths/min",
        status: i === values.length - 1 && analysis.flagged ? "alert" : "info",
        created_at: d.toISOString(),
      };
    });
    const { error } = await supabase.from("sensor_events").insert(rows);
    setNights(values);
    setMsg(error ? { text: `Could not save: ${error.message}`, tone: "err" } : { text: analysis.explanation, tone: analysis.flagged ? "warn" : "ok" });
    setBusy(false);
  };

  const clearSimulated = async () => {
    setBusy(true);
    const supabase = createClient();
    const [a, b] = await Promise.all([
      supabase.from("sensor_events").delete().eq("source", "simulated_sensor"),
      supabase.from("fall_events").delete().like("device_id", "SIM-%"),
    ]);
    setNights([]);
    await loadEvents();
    setMsg(a.error || b.error ? { text: `Could not clear: ${(a.error ?? b.error)!.message}`, tone: "err" } : { text: "All simulated radar data removed.", tone: "ok" });
    setBusy(false);
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const secondsLeft = fall.phase === "confirming" ? Math.max(0, Math.ceil((FALL_CONFIRM_MS - (now - fall.since)) / 1000)) : 0;
  const nightAnalysis = nights.length ? analyseNightBreathing(nights) : null;
  const toneCls = {
    ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    alert: "bg-red-600 border-red-700 text-white font-semibold",
    err: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-slate-900">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/85 border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-indigo-600 text-white">
            <Radar className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold leading-tight">60 GHz Radar Lab</h1>
            <p className="text-[11px] text-slate-500 hidden sm:block">Camera-free fall and breathing monitoring · simulated</p>
          </div>
          <select
            value={residentId}
            onChange={(e) => {
              setResidentId(e.target.value);
              setNights([]);
            }}
            className="ml-auto border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white max-w-[220px]"
            aria-label="Resident"
          >
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
                {r.room_number ? ` · ${r.room_number}` : ""}
              </option>
            ))}
          </select>
          <button
            onClick={clearSimulated}
            disabled={busy}
            title="Clear simulated data"
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 shrink-0" />
          <span>
            <strong>SIMULATED</strong>: no hardware connected. Readings are generated in the browser; events are saved as
            <code className="mx-1">simulated_sensor</code>and the fall alert uses the real ElderLink pipeline.
          </span>
        </div>

        {msg && (
          <div role="status" className={`rounded-2xl border px-4 py-3 text-sm ${toneCls[msg.tone]}`}>
            {msg.text}
            {msg.tone === "alert" && (
              <Link href="/staff/dashboard" className="ml-2 underline">
                Open dashboard →
              </Link>
            )}
          </div>
        )}

        <div className="grid lg:grid-cols-[1.35fr_1fr] gap-4">
          {/* Room */}
          <section className="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                Room {room}
                {resident ? ` · ${resident.full_name}` : ""}
              </h2>
              <span
                className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  fall.phase === "alerted"
                    ? "bg-red-600 text-white"
                    : fall.phase === "confirming"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-50 text-emerald-700"
                }`}
              >
                {fall.phase === "alerted" ? "FALL ALERT SENT" : fall.phase === "confirming" ? `Confirming fall… ${secondsLeft}s` : "Monitoring"}
              </span>
            </div>
            <RoomView posture={posture} fall={fall.phase} />

            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">What is the resident doing?</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SCENARIOS.map((s) => {
                  const active = posture === s.posture;
                  return (
                    <button
                      key={s.posture}
                      onClick={(e) => choose(s.posture, Math.round(performance.timeOrigin + e.timeStamp))}
                      aria-pressed={active}
                      className={`flex items-center gap-2 rounded-2xl border-2 px-3 py-3 text-left text-sm font-semibold transition-all active:scale-[0.98] ${
                        active
                          ? s.danger
                            ? "border-red-500 bg-red-50 text-red-700"
                            : "border-indigo-500 bg-indigo-50 text-indigo-800"
                          : s.danger
                          ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <s.icon className="w-4 h-4 shrink-0" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* Live readings */}
          <section className="space-y-4">
            <div className="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-indigo-600" />
                </span>
                <h2 className="font-bold">Live radar readings</h2>
                <span className="ml-auto text-[11px] text-slate-400">1 frame / second</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Tile label="Posture" value={POSTURE_LABEL[posture]} tone={posture === "fallen" ? "red" : "slate"} />
                <Tile
                  label="Height above floor"
                  value={reading?.bodyHeightM != null ? `${reading.bodyHeightM.toFixed(2)} m` : "—"}
                  sub={posture === "fallen" ? "below 0.3 m: on the floor" : undefined}
                  tone={posture === "fallen" ? "red" : "slate"}
                />
                <Tile label="Motion" value={reading ? (reading.motion === "none" ? "No one" : reading.motion === "moving" ? "Moving" : "Still") : "—"} />
                <Tile label="Presence" value={reading?.presence ? "Detected" : "None"} tone={reading?.presence ? "teal" : "slate"} />
              </div>

              <div className="rounded-2xl bg-slate-50 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                    <Wind className="w-4 h-4 text-teal-700" /> Breathing
                  </span>
                  <span className="font-black text-teal-700">{reading?.breathing != null ? `${reading.breathing} /min` : "—"}</span>
                </div>
                <BreathWave rate={reading?.breathing ?? null} />
                <div className="flex items-center justify-between text-sm mt-1">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                    <HeartPulse
                      className="w-4 h-4 text-rose-600"
                      style={reading?.heartRate ? { animation: `sl-beat ${(60 / reading.heartRate).toFixed(2)}s ease-in-out infinite` } : undefined}
                    />
                    Heart rate <span className="text-[10px] text-slate-400 font-normal">(radar estimate)</span>
                  </span>
                  <span className="font-black text-rose-600">{reading?.heartRate != null ? `${reading.heartRate} bpm` : "—"}</span>
                </div>
                <style>{`@keyframes sl-beat { 0%,100% { transform: scale(1) } 15% { transform: scale(1.25) } }`}</style>
                {reading?.motion === "moving" && (
                  <p className="text-[11px] text-slate-500 mt-1">Vitals are read only while the person is still (from tiny chest movements).</p>
                )}
              </div>

              <div className="text-[11px] text-slate-500 leading-relaxed flex gap-2">
                <CircleDot className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
                <span>
                  <strong>Fall rule:</strong> body height drops faster than 1 m/s <em>and</em> stays below 0.3 m for{" "}
                  {FALL_CONFIRM_MS / 1000} s. Sitting down slowly on the floor to eat or pray is not a fall.
                </span>
              </div>
            </div>

            {/* Sleep breathing history from the same radar */}
            <div className="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs space-y-3">
              <h2 className="font-bold flex items-center gap-2">
                <BedDouble className="w-4 h-4 text-indigo-600" /> 14 nights of sleep breathing
              </h2>
              <div className="flex gap-2">
                {(["normal", "rising"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTrend(t)}
                    aria-pressed={trend === t}
                    className={`flex-1 text-xs font-bold py-2 rounded-xl border ${trend === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200"}`}
                  >
                    {t === "normal" ? "Steady" : "Rising last 3 nights"}
                  </button>
                ))}
              </div>
              <button
                onClick={simulateNights}
                disabled={busy || !resident}
                className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wind className="w-4 h-4" />} Simulate 14 nights
              </button>
              {nightAnalysis && (
                <div className={`rounded-xl border px-3 py-2 ${nightAnalysis.flagged ? STATUS_CLS.alert : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
                  <Spark values={nights} flagged={nightAnalysis.flagged} />
                  <p className="text-xs mt-1">{nightAnalysis.explanation}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Event log */}
        <section className="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs">
          <h2 className="font-bold mb-2">Radar event log</h2>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">No radar events yet. Choose what the resident is doing above.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-slate-400 w-24 shrink-0">
                    {new Date(e.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-medium text-slate-700">
                    {e.event_type.startsWith("posture:")
                      ? POSTURE_LABEL[e.event_type.slice(8) as Posture] ?? e.event_type
                      : e.event_type.replace(/_/g, " ")}
                    {e.value != null ? ` (${e.value} ${e.unit ?? ""})` : ""}
                  </span>
                  <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-md border ${STATUS_CLS[e.status ?? "info"] ?? STATUS_CLS.info}`}>
                    {e.status ?? "info"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
