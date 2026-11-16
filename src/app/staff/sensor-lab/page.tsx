"use client";

/**
 * Sensor Lab: SIMULATED sensors feeding ElderLink's real alert pipeline.
 *
 *  - Ceiling mmWave radar → creates a real fall_events row → the live fall
 *    alert pops up on the staff dashboard (LiveAlerts) within a second.
 *  - Bed mat, wearable pulse/SpO2, bedside sleep radar → sensor_events rows,
 *    interpreted against safe limits or the resident's own normal.
 *
 * Every row is labelled source = 'simulated_sensor' / device SIM-*, and
 * "Clear simulated data" removes them.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowLeft,
  BedDouble,
  Cpu,
  FlaskConical,
  HeartPulse,
  Loader2,
  Moon,
  Radio,
  Trash2,
  Wind,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  analyseNightBreathing,
  interpretVitals,
  SENSOR_INFO,
  simulateNightBreathing,
  type SensorKind,
} from "@/lib/sensors/sim";

type Resident = { id: string; full_name: string; room_number: string | null };
/** ok = all normal, warn = someone should check, alert = emergency, err = app error */
type Tone = "ok" | "warn" | "alert" | "err";
type Outcome = { text: string; tone: Tone };

const TONE_CLS: Record<Tone, string> = {
  ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
  warn: "bg-amber-50 border-amber-200 text-amber-900",
  alert: "bg-red-50 border-red-300 text-red-900 font-semibold",
  err: "bg-red-50 border-red-200 text-red-800",
};
type SensorEvent = {
  id: string;
  created_at: string;
  event_type: string;
  sensor_type: string | null;
  room: string;
  status: string | null;
  value: number | null;
  unit: string | null;
  payload: Record<string, unknown> | null;
  resident_id: string | null;
};

const LEVEL_CLS: Record<string, string> = {
  alert: "bg-red-50 text-red-700 border-red-200",
  watch: "bg-amber-50 text-amber-700 border-amber-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  info: "bg-slate-50 text-slate-600 border-slate-200",
};

function Card({
  kind,
  icon: Icon,
  children,
}: {
  kind: SensorKind;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const info = SENSOR_INFO[kind];
  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 space-y-3 shadow-xs">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700 shrink-0">
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900">{info.name}</h2>
          <p className="text-xs text-slate-600">{info.detects}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Real hardware: {info.cost}</p>
        </div>
      </div>
      {children}
    </section>
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
      <path d={d} fill="none" stroke={flagged ? "#dc2626" : "#4F9C8B"} strokeWidth={2} strokeLinejoin="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.2} fill={flagged && i >= values.length - 3 ? "#dc2626" : "#4F9C8B"} />
      ))}
    </svg>
  );
}

export default function SensorLabPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentId, setResidentId] = useState("");
  const [feed, setFeed] = useState<SensorEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: Tone } | null>(null);

  const [bedMinutes, setBedMinutes] = useState(25);
  const [hr, setHr] = useState(78);
  const [spo2, setSpo2] = useState(97);
  const [trend, setTrend] = useState<"normal" | "rising">("rising");
  const [nights, setNights] = useState<number[]>([]);

  const resident = residents.find((r) => r.id === residentId) ?? null;
  const room = resident?.room_number || "Unassigned";
  const nameOf = useCallback((id: string | null) => residents.find((r) => r.id === id)?.full_name ?? "Resident", [residents]);

  const loadFeed = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("sensor_events")
      .select("id, created_at, event_type, sensor_type, room, status, value, unit, payload, resident_id")
      .order("created_at", { ascending: false })
      .limit(30);
    setFeed((data as SensorEvent[]) ?? []);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      const [{ data: staffRow }, { data: rows }] = await Promise.all([
        supabase.from("staff").select("id").eq("id", data.user.id).maybeSingle(),
        supabase.from("residents").select("id, full_name, room_number").eq("status", "active").order("full_name"),
      ]);
      if (cancelled) return;
      setUserId(data.user.id);
      setIsStaff(Boolean(staffRow));
      setResidents((rows as Resident[]) ?? []);
      setResidentId((rows as Resident[] | null)?.[0]?.id ?? "");
      await loadFeed();
      setReady(true);
      channel = supabase
        .channel("sensor-lab")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "sensor_events" }, (p) => {
          setFeed((prev) => [p.new as SensorEvent, ...prev].slice(0, 30));
        })
        .subscribe();
    })();
    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, loadFeed]);

  const run = async (key: string, fn: () => Promise<Outcome>) => {
    if (!resident && key !== "clear") {
      setMsg({ text: "Choose a resident first.", tone: "err" });
      return;
    }
    setBusy(key);
    setMsg(null);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Something went wrong.", tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  const insertEvent = async (row: Record<string, unknown>) => {
    const supabase = createClient();
    const { error } = await supabase.from("sensor_events").insert({
      source: "simulated_sensor",
      resident_id: resident!.id,
      room,
      ...row,
    });
    if (error) throw new Error(`Could not save sensor event: ${error.message}`);
  };

  /* ---- device actions ------------------------------------------------ */

  const simulateFall = () =>
    run("fall", async () => {
      const supabase = createClient();
      const deviceId = `SIM-RADAR-${room}`;
      const { error } = await supabase.from("fall_events").insert({
        device_id: deviceId,
        resident_id: resident!.id,
        status: "unresolved",
        z_drop: 2.6,
        doppler_spike: 1.8,
      });
      if (error) throw new Error(`Could not create fall alert: ${error.message}`);
      await insertEvent({
        sensor_type: "mmwave_radar",
        device_id: deviceId,
        event_type: "fall_detected",
        status: "alert",
        payload: { posture: "on_floor", still_seconds: 30 },
      });
      return { text: `Fall detected by the ceiling radar in room ${room}. The live fall alert is now on the staff dashboard.`, tone: "alert" };
    });

  const simulateBedExit = () =>
    run("bed", async () => {
      const level = bedMinutes >= 20 ? "alert" : "info";
      await insertEvent({
        sensor_type: "bed_mat",
        device_id: `SIM-BED-${room}`,
        event_type: "bed_exit",
        value: bedMinutes,
        unit: "min",
        status: level,
        payload: { night: true },
      });
      return level === "alert"
        ? { text: `${resident!.full_name} left bed ${bedMinutes} min ago and has not returned. Check the bathroom and floor now.`, tone: "warn" }
        : { text: `${resident!.full_name} got up for ${bedMinutes} min and returned to bed. Logged, no action needed.`, tone: "ok" };
    });

  const verdict = interpretVitals(hr, spo2);
  const sendVitals = (raiseAlert: boolean) =>
    run("vitals", async () => {
      await insertEvent({
        sensor_type: "wearable",
        device_id: `SIM-WEAR-${room}`,
        event_type: "vitals",
        value: hr,
        unit: "bpm",
        status: verdict.level,
        payload: { hr, spo2 },
      });
      if (raiseAlert) {
        const supabase = createClient();
        const { error } = await supabase.from("emergency_alerts").insert({
          resident_id: resident!.id,
          type: "abnormal vitals (wearable)",
          status: "open",
          raised_by: isStaff ? userId : null,
        });
        if (error) throw new Error(`Reading saved, but the alert could not be raised: ${error.message}`);
        return { text: "Reading saved and emergency alert raised. It shows on the dashboard and in the handover.", tone: "alert" };
      }
      return { text: `Reading saved: ${verdict.message}`, tone: verdict.level === "ok" ? "ok" : "warn" };
    });

  const simulateNights = () =>
    run("nights", async () => {
      const values = simulateNightBreathing(trend, 14, Math.floor(Math.random() * 1000));
      const analysis = analyseNightBreathing(values);
      const supabase = createClient();
      const rows = values.map((v, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (values.length - 1 - i));
        d.setHours(2, 0, 0, 0);
        return {
          source: "simulated_sensor",
          resident_id: resident!.id,
          room,
          sensor_type: "sleep_radar",
          device_id: `SIM-SLEEP-${room}`,
          event_type: "sleep_breathing",
          value: v,
          unit: "breaths/min",
          status: i === values.length - 1 && analysis.flagged ? "alert" : "info",
          created_at: d.toISOString(),
        };
      });
      const { error } = await supabase.from("sensor_events").insert(rows);
      if (error) throw new Error(`Could not save night readings: ${error.message}`);
      setNights(values);
      return { text: analysis.explanation, tone: analysis.flagged ? "warn" : "ok" };
    });

  const clearSimulated = () =>
    run("clear", async () => {
      const supabase = createClient();
      const [a, b] = await Promise.all([
        supabase.from("sensor_events").delete().eq("source", "simulated_sensor"),
        supabase.from("fall_events").delete().like("device_id", "SIM-%"),
      ]);
      if (a.error || b.error) throw new Error(`Could not clear: ${(a.error ?? b.error)!.message}`);
      setNights([]);
      await loadFeed();
      return { text: "All simulated sensor data removed.", tone: "ok" };
    });

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const nightAnalysis = nights.length ? analyseNightBreathing(nights) : null;

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-slate-900">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#FAFAF8]/90 border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-indigo-50 text-indigo-700">
            <Cpu className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold leading-tight">Sensor Lab</h1>
            <p className="text-[11px] text-slate-500 hidden sm:block">Simulated low-cost sensors feeding ElderLink&apos;s real alerts</p>
          </div>
          <button
            onClick={clearSimulated}
            disabled={busy !== null}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear simulated data
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/60 p-3 text-sm text-indigo-900 flex items-start gap-2">
          <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <strong>SIMULATED SENSORS.</strong> No hardware is connected. Each button creates the same data a real device
            would send, marked <code>simulated_sensor</code> / <code>SIM-*</code>, so you can see the full alert pipeline working.
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-wrap items-center gap-3">
          <label htmlFor="res" className="text-sm font-bold">Resident</label>
          <select
            id="res"
            value={residentId}
            onChange={(e) => {
              setResidentId(e.target.value);
              setNights([]);
            }}
            className="border border-slate-200 rounded-xl px-3 py-2 text-sm flex-1 min-w-[200px]"
          >
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
                {r.room_number ? ` · Room ${r.room_number}` : ""}
              </option>
            ))}
          </select>
        </div>

        {msg && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${TONE_CLS[msg.tone]}`}
          >
            {msg.text}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <Card kind="mmwave_radar" icon={Radio}>
            <button
              onClick={simulateFall}
              disabled={busy !== null}
              className="w-full inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
            >
              {busy === "fall" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
              Simulate a fall in room {room}
            </button>
            <p className="text-[11px] text-slate-500">
              Open the <Link href="/staff/dashboard" className="underline">staff dashboard</Link> in another tab to watch the alert arrive live.
            </p>
          </Card>

          <Card kind="bed_mat" icon={BedDouble}>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 shrink-0">Out of bed for</span>
              <input
                type="range"
                min={2}
                max={60}
                value={bedMinutes}
                onChange={(e) => setBedMinutes(Number(e.target.value))}
                className="flex-1 accent-indigo-600"
                aria-label="Minutes out of bed"
              />
              <span className="text-sm font-bold w-14 text-right">{bedMinutes} min</span>
            </div>
            <button
              onClick={simulateBedExit}
              disabled={busy !== null}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
            >
              {busy === "bed" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Moon className="w-4 h-4" />}
              Simulate night bed-exit
            </button>
            <p className="text-[11px] text-slate-500">20 min or more without returning becomes an alert.</p>
          </Card>

          <Card kind="wearable" icon={HeartPulse}>
            <div className="flex flex-wrap gap-1.5">
              {[
                { l: "Normal", h: 76, s: 97 },
                { l: "Fast heart", h: 136, s: 95 },
                { l: "Low oxygen", h: 98, s: 87 },
                { l: "Slow heart", h: 44, s: 96 },
              ].map((p) => (
                <button
                  key={p.l}
                  onClick={() => {
                    setHr(p.h);
                    setSpo2(p.s);
                  }}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100"
                >
                  {p.l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
              <span className="text-slate-600">Heart rate</span>
              <input type="range" min={35} max={170} value={hr} onChange={(e) => setHr(Number(e.target.value))} className="accent-indigo-600" aria-label="Heart rate" />
              <span className="font-bold w-16 text-right">{hr} bpm</span>
              <span className="text-slate-600">Oxygen</span>
              <input type="range" min={80} max={100} value={spo2} onChange={(e) => setSpo2(Number(e.target.value))} className="accent-indigo-600" aria-label="Oxygen saturation" />
              <span className="font-bold w-16 text-right">{spo2}%</span>
            </div>
            <div className={`rounded-xl border px-3 py-2 text-sm ${LEVEL_CLS[verdict.level]}`}>
              <p className="font-semibold">{verdict.message}</p>
              {verdict.actions.length > 0 && (
                <ul className="list-disc pl-5 text-xs mt-1 space-y-0.5">
                  {verdict.actions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => sendVitals(false)}
                disabled={busy !== null}
                className="flex-1 inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
              >
                {busy === "vitals" ? <Loader2 className="w-4 h-4 animate-spin" /> : <HeartPulse className="w-4 h-4" />}
                Send reading
              </button>
              {verdict.level === "alert" && (
                <button
                  onClick={() => sendVitals(true)}
                  disabled={busy !== null}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
                >
                  Send &amp; raise alert
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500">
              A wearable cannot diagnose a heart attack. It flags readings that need a person to check now.
            </p>
          </Card>

          <Card kind="sleep_radar" icon={Wind}>
            <div className="flex gap-2">
              {(["normal", "rising"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTrend(t)}
                  aria-pressed={trend === t}
                  className={`flex-1 text-xs font-bold py-2 rounded-lg border ${trend === t ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-slate-600 border-slate-200"}`}
                >
                  {t === "normal" ? "Steady nights" : "Rising over last 3 nights"}
                </button>
              ))}
            </div>
            <button
              onClick={simulateNights}
              disabled={busy !== null}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
            >
              {busy === "nights" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wind className="w-4 h-4" />}
              Simulate 14 nights of sleep breathing
            </button>
            {nightAnalysis && (
              <div className={`rounded-xl border px-3 py-2 ${nightAnalysis.flagged ? LEVEL_CLS.alert : LEVEL_CLS.ok}`}>
                <Spark values={nights} flagged={nightAnalysis.flagged} />
                <p className="text-xs mt-1">{nightAnalysis.explanation}</p>
              </div>
            )}
          </Card>
        </div>

        <section className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
          <h2 className="font-bold mb-3 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Live sensor feed
          </h2>
          {feed.length === 0 ? (
            <p className="text-sm text-slate-500">No sensor events yet. Press a button above.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {feed.map((e) => (
                <li key={e.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs text-slate-400 w-28 shrink-0">
                    {new Date(e.created_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="font-semibold">{nameOf(e.resident_id)}</span>
                  <span className="text-slate-500">· Rm {e.room}</span>
                  <span className="text-slate-700">
                    {e.event_type.replace(/_/g, " ")}
                    {e.payload && typeof e.payload === "object" && "spo2" in e.payload
                      ? ` (HR ${String(e.payload.hr)}, SpO₂ ${String(e.payload.spo2)}%)`
                      : e.value != null
                      ? ` (${e.value} ${e.unit ?? ""})`
                      : ""}
                  </span>
                  <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-md border ${LEVEL_CLS[e.status ?? "info"] ?? LEVEL_CLS.info}`}>
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
