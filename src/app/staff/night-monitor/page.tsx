"use client";

/**
 * Night Monitor: SIMULATED bed mats + one shared-bathroom radar per ward.
 *
 * 1. Choose a ward and what each bed's nights look like (normal, more
 *    bathroom trips, restless, faster breathing).
 * 2. "Simulate 14 nights" generates the sensor events, joins bed exits to
 *    shared-bathroom visits by timing, and stores one summary per resident
 *    per night (sleep, bathroom visits, bed exits, breathing) through
 *    record_sensor_day().
 * 3. The Early Warning engine learns each resident's 1-week normal and
 *    flags the last 3 nights if they differ. Results show here and in
 *    Early Warning / Behaviour Alerts.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, BedDouble, FlaskConical, Loader2, Moon, Radar, Send, ShowerHead } from "lucide-react";
import { FALL_CONFIRM_MS } from "@/lib/sensors/radar";
import { createClient } from "@/lib/supabase/client";
import { loadWards, type Ward } from "@/lib/wards/wards";
import { clockOf, SCENARIO_LABEL, seeded, simulateWardNight, type NightScenario, type WardNight } from "@/lib/sensors/night";
import { runEarlyWarning, type ResidentReport, type SensorDayInput } from "@/lib/early-warning/engine";

const COLORS = ["#0f766e", "#7c3aed", "#ea580c", "#2563eb", "#db2777", "#65a30d", "#0891b2", "#b45309"];

/** Demo defaults for the seeded residents; everyone else starts as normal. */
const DEFAULT_SCENARIO: Record<string, NightScenario> = {
  "Antonio Lopez": "urinary",
  Ramanna: "restless",
};

function isoDateDaysAgo(ago: number) {
  const d = new Date();
  d.setDate(d.getDate() - ago);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Timeline({ ward, night }: { ward: Ward; night: WardNight }) {
  const W = 640;
  const rowH = 26;
  const left = 92;
  const span = 600; // 21:00 → 07:00
  const x = (m: number) => left + (Math.max(0, Math.min(span, m)) / span) * (W - left - 8);
  const beds = ward.beds.filter((b) => b.resident);
  const H = (beds.length + 1) * rowH + 30;
  const colorOf = (bedId: string | null) => {
    const i = beds.findIndex((b) => b.id === bedId);
    return i >= 0 ? COLORS[i % COLORS.length] : "#94a3b8";
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Last night timeline">
      {[0, 120, 240, 360, 480, 600].map((m) => (
        <g key={m}>
          <line x1={x(m)} x2={x(m)} y1={4} y2={H - 22} stroke="#e2e8f0" />
          <text x={x(m)} y={H - 8} fontSize="10" textAnchor="middle" fill="#64748b">
            {clockOf(m)}
          </text>
        </g>
      ))}
      {beds.map((b, i) => {
        const bn = night.beds.find((n) => n.bedId === b.id);
        const y = 6 + i * rowH;
        if (!bn) return null;
        return (
          <g key={b.id}>
            <text x={4} y={y + 15} fontSize="11" fill="#0f172a" fontWeight="600">
              {b.label} · {b.resident!.full_name.split(" ")[0]}
            </text>
            <rect x={x(bn.bedtime)} y={y + 4} width={x(bn.wake) - x(bn.bedtime)} height={14} rx={4} fill={colorOf(b.id)} opacity={0.22} />
            {bn.outOfBed.map((o, k) => (
              <rect key={k} x={x(o.start)} y={y + 2} width={Math.max(3, x(o.end) - x(o.start))} height={18} rx={3} fill={o.toBathroom ? "#f59e0b" : "#ef4444"}>
                <title>{`${o.toBathroom ? "Bathroom trip" : "Up, not bathroom"} ${clockOf(o.start)}–${clockOf(o.end)}`}</title>
              </rect>
            ))}
          </g>
        );
      })}
      {/* shared bathroom row */}
      <g>
        <text x={4} y={6 + beds.length * rowH + 15} fontSize="11" fill="#0369a1" fontWeight="700">
          Bathroom radar
        </text>
        <rect x={left} y={6 + beds.length * rowH + 4} width={W - left - 8} height={14} rx={4} fill="#e0f2fe" />
        {night.bathroom.map((v, k) => (
          <rect key={k} x={x(v.start)} y={6 + beds.length * rowH + 2} width={Math.max(4, x(v.end) - x(v.start))} height={18} rx={3} fill={colorOf(v.attributedBedId)}>
            <title>{`${clockOf(v.start)} occupied → credited to ${beds.find((b) => b.id === v.attributedBedId)?.label ?? "unknown"}`}</title>
          </rect>
        ))}
      </g>
    </svg>
  );
}

export default function NightMonitorPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [wards, setWards] = useState<Ward[]>([]);
  const [wardId, setWardId] = useState("");
  const [scenario, setScenario] = useState<Record<string, NightScenario>>({});
  const [lastNight, setLastNight] = useState<WardNight | null>(null);
  const [reports, setReports] = useState<ResidentReport[]>([]);
  const [nightsByBed, setNightsByBed] = useState<Record<string, SensorDayInput[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  // Shared-bathroom 60 GHz radar fall simulation.
  const [fallWho, setFallWho] = useState<string>("unknown");
  const [fallPhase, setFallPhase] = useState<"idle" | "confirming" | "alerted">("idle");
  const [fallCountdown, setFallCountdown] = useState(0);
  const [fallMsg, setFallMsg] = useState<string | null>(null);
  const fallTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(
    () => () => {
      if (fallTimer.current) clearInterval(fallTimer.current);
    },
    []
  );
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      const res = await loadWards(supabase);
      if (cancelled) return;
      setWards(res.wards);
      setWardId(res.wards[0]?.id ?? "");
      const init: Record<string, NightScenario> = {};
      for (const w of res.wards) for (const b of w.beds) if (b.resident) init[b.id] = DEFAULT_SCENARIO[b.resident.full_name] ?? "normal";
      setScenario(init);
      if (res.error) setMsg({ text: res.error, tone: "err" });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const ward = wards.find((w) => w.id === wardId) ?? null;
  const occupied = useMemo(() => ward?.beds.filter((b) => b.resident) ?? [], [ward]);

  const simulate = useCallback(async () => {
    if (!ward || occupied.length === 0) return;
    setBusy("sim");
    setMsg(null);
    setProgress(0);
    const seedBase = Math.floor(Math.random() * 100000);
    const days: SensorDayInput[] = [];
    let last: WardNight | null = null;
    for (let ago = 13; ago >= 0; ago--) {
      const night = simulateWardNight(
        occupied.map((b) => ({ bedId: b.id, scenario: scenario[b.id] ?? "normal" })),
        ago <= 2,
        seeded(seedBase + ago)
      );
      if (ago === 0) last = night;
      for (const s of night.summaries) {
        const bed = occupied.find((b) => b.id === s.bedId)!;
        days.push({
          resident_id: bed.resident!.id,
          date: isoDateDaysAgo(ago),
          sleep_hours: s.sleepHours,
          washroom_visits: s.bathroomVisits,
          night_bed_exits: s.bedExits,
          night_breathing_rate: s.breathing,
          sensor_source: "simulated",
        });
      }
    }

    // Save through the staff-only database function.
    const supabase = createClient();
    let done = 0;
    let failed: string | null = null;
    for (let i = 0; i < days.length; i += 8) {
      const chunk = days.slice(i, i + 8);
      const results = await Promise.all(
        chunk.map((d) =>
          supabase.rpc("record_sensor_day", {
            p_resident_id: d.resident_id,
            p_date: d.date,
            p_sleep_hours: d.sleep_hours,
            p_washroom_visits: d.washroom_visits,
            p_night_bed_exits: d.night_bed_exits,
            p_night_breathing_rate: d.night_breathing_rate,
            p_sleep_disturbed: (d.night_bed_exits ?? 0) >= 3,
            p_source: "simulated",
          })
        )
      );
      const err = results.find((r) => r.error)?.error;
      if (err && !failed) failed = err.message;
      done += chunk.length;
      setProgress(Math.round((done / days.length) * 100));
    }

    // Same engine as Early Warning, on just these sensor nights.
    const report = runEarlyWarning({
      residents: occupied.map((b) => ({ id: b.resident!.id, full_name: b.resident!.full_name, room_number: `${ward.name} · ${b.label}` })),
      logs: [],
      sensorDays: days,
    });
    const byBed: Record<string, SensorDayInput[]> = {};
    for (const b of occupied) byBed[b.id] = days.filter((d) => d.resident_id === b.resident!.id);
    setNightsByBed(byBed);
    setReports(report.residents);
    setLastNight(last);
    setBusy(null);
    const flagged = report.residents.filter((r) => r.flaggedSignals.length).length;
    setMsg(
      failed
        ? { text: `Simulated, but saving failed: ${failed}`, tone: "err" }
        : {
            text: `14 nights simulated for ${occupied.length} residents and saved. ${flagged} resident${flagged === 1 ? " differs" : "s differ"} from their 1-week normal.`,
            tone: flagged ? "warn" : "ok",
          }
    );
  }, [ward, occupied, scenario]);

  const analyse = async () => {
    setBusy("analyse");
    try {
      const res = await fetch("/api/behavior-analysis", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed");
      setMsg({
        text: `Behaviour analysis run: ${json.alertsInserted} new alert${json.alertsInserted === 1 ? "" : "s"} sent to staff (${json.alertsSkipped} already open).`,
        tone: json.alertsInserted ? "warn" : "ok",
      });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Analysis failed", tone: "err" });
    } finally {
      setBusy(null);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F7FB]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const reportOf = (residentId: string) => reports.find((r) => r.resident_id === residentId);
  const toneCls = {
    ok: "bg-emerald-50 border-emerald-200 text-emerald-900",
    warn: "bg-amber-50 border-amber-200 text-amber-900",
    err: "bg-red-50 border-red-200 text-red-800",
  };

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-slate-900">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-indigo-600 text-white">
            <Moon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold leading-tight">Ward sensors</h1>
            <p className="text-[11px] text-slate-500 hidden sm:block">Bed mats + shared-bathroom radar → each resident&apos;s night, compared with their 1-week normal</p>
          </div>
          <div className="ml-auto flex gap-1.5">
            {wards.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setWardId(w.id);
                  setLastNight(null);
                  setReports([]);
                  setMsg(null);
                }}
                aria-pressed={w.id === wardId}
                className={`px-3 py-2 rounded-xl text-sm font-bold border ${w.id === wardId ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
              >
                {w.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 space-y-4">
        <div className="rounded-xl border border-dashed border-indigo-300 bg-indigo-50/70 px-3 py-2 text-xs text-indigo-900 flex items-center gap-2">
          <FlaskConical className="w-4 h-4 shrink-0" />
          <span>
            <strong>SIMULATED SENSORS</strong>: one bed-exit mat per bed and one 60 GHz radar in the shared bathroom.
            Summaries are saved with <code>sensor_source = simulated</code>; re-running replaces them.
          </span>
        </div>

        {msg && <div role="status" className={`rounded-2xl border px-4 py-3 text-sm ${toneCls[msg.tone]}`}>{msg.text}</div>}

        {ward && (
          <section className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold">{ward.name}: what are each resident&apos;s nights like?</h2>
              <span className="text-xs text-slate-500">{occupied.length} beds occupied · changes apply to the last 3 nights</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {occupied.map((b, i) => (
                <label key={b.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                  <span className="text-sm font-semibold flex-1 min-w-[140px]">
                    {b.label} · {b.resident!.full_name}
                  </span>
                  <select
                    value={scenario[b.id] ?? "normal"}
                    onChange={(e) => setScenario((s) => ({ ...s, [b.id]: e.target.value as NightScenario }))}
                    className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white w-full sm:w-auto"
                  >
                    {(Object.keys(SCENARIO_LABEL) as NightScenario[]).map((s) => (
                      <option key={s} value={s}>
                        {SCENARIO_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={simulate}
                disabled={busy !== null || occupied.length === 0}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-5 py-3 rounded-2xl disabled:opacity-50"
              >
                {busy === "sim" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Moon className="w-4 h-4" />}
                {busy === "sim" ? `Simulating… ${progress}%` : "Simulate last 14 nights"}
              </button>
              {reports.length > 0 && (
                <button
                  onClick={analyse}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-2 bg-[#357366] text-white font-bold px-5 py-3 rounded-2xl disabled:opacity-50"
                >
                  {busy === "analyse" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send changes to staff (behaviour alerts)
                </button>
              )}
            </div>
          </section>
        )}

        {ward && (
          <section className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-sky-50 text-sky-700 shrink-0">
                <ShowerHead className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold">{ward.name} shared bathroom: 60 GHz radar fall detection</h2>
                <p className="text-xs text-slate-600">
                  A fast drop to the floor followed by {FALL_CONFIRM_MS / 1000} s without getting up raises a fall alert. The
                  radar can&apos;t see who it is, so ElderLink credits the resident whose bed mat registered an exit in the
                  last few minutes.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm font-semibold" htmlFor="fall-who">
                Who walked in?
              </label>
              <select
                id="fall-who"
                value={fallWho}
                onChange={(e) => setFallWho(e.target.value)}
                disabled={fallPhase === "confirming"}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white min-w-[220px]"
              >
                {occupied.map((b) => (
                  <option key={b.id} value={b.resident!.id}>
                    {b.resident!.full_name} (left {b.label})
                  </option>
                ))}
                <option value="unknown">Nobody left a bed recently (unknown)</option>
              </select>
              {fallPhase !== "confirming" ? (
                <button
                  onClick={() => {
                    const w = ward;
                    const who = fallWho;
                    let left = FALL_CONFIRM_MS / 1000;
                    setFallPhase("confirming");
                    setFallCountdown(left);
                    setFallMsg(null);
                    fallTimer.current = setInterval(() => {
                      left -= 1;
                      setFallCountdown(left);
                      if (left <= 0) {
                        if (fallTimer.current) clearInterval(fallTimer.current);
                        fallTimer.current = null;
                        void (async () => {
                          const supabase = createClient();
                          const short = w.name.replace(/\s+/g, "").toUpperCase();
                          const deviceId = `SIM-RADAR60-BATH-${short}`;
                          const residentId = who === "unknown" ? null : who;
                          const { error } = await supabase.from("fall_events").insert({
                            device_id: deviceId,
                            resident_id: residentId,
                            status: "unresolved",
                            z_drop: 2.2,
                            doppler_spike: 1.8,
                          });
                          await supabase.from("sensor_events").insert({
                            source: "simulated_sensor",
                            sensor_type: "mmwave_radar",
                            device_id: deviceId,
                            room: `${w.name} bathroom`,
                            resident_id: residentId,
                            event_type: "fall_confirmed",
                            status: "alert",
                            payload: { credited_by: residentId ? "last bed exit" : "none" },
                          });
                          const name = occupied.find((b) => b.resident!.id === who)?.resident!.full_name;
                          setFallPhase("alerted");
                          setFallMsg(
                            error
                              ? `Fall confirmed, but the alert could not be saved: ${error.message}`
                              : `Fall confirmed in the ${w.name} bathroom${name ? `, credited to ${name}` : " (person unknown)"}. The alert is live on the staff dashboard.`
                          );
                        })();
                      }
                    }, 1000);
                  }}
                  className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2.5 rounded-xl"
                >
                  <AlertTriangle className="w-4 h-4" /> Simulate a fall in the bathroom
                </button>
              ) : (
                <button
                  onClick={() => {
                    if (fallTimer.current) clearInterval(fallTimer.current);
                    fallTimer.current = null;
                    setFallPhase("idle");
                    setFallMsg("They got up within the confirmation window, so no alert was raised.");
                  }}
                  className="inline-flex items-center gap-2 border border-slate-300 bg-white font-bold px-4 py-2.5 rounded-xl"
                >
                  They got up (cancel)
                </button>
              )}
            </div>
            {fallPhase === "confirming" && (
              <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 font-semibold">
                Fast drop detected. Person on the bathroom floor: alert in {fallCountdown} s unless they get up…
              </p>
            )}
            {fallMsg && (
              <p
                className={`rounded-xl border px-3 py-2 text-sm ${
                  fallPhase === "alerted" ? "bg-red-600 border-red-700 text-white font-semibold" : "bg-emerald-50 border-emerald-200 text-emerald-900"
                }`}
              >
                {fallMsg}
                {fallPhase === "alerted" && (
                  <Link href="/staff/dashboard" className="ml-2 underline">
                    Open dashboard →
                  </Link>
                )}
              </p>
            )}
          </section>
        )}

        {ward && lastNight && (
          <section className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-5 shadow-xs space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-bold">Last night in {ward.name}</h2>
              <span className="text-[11px] text-slate-500 inline-flex items-center gap-3">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-amber-400" /> bathroom trip</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-red-500" /> up, not bathroom</span>
                <span className="inline-flex items-center gap-1"><ShowerHead className="w-3 h-3 text-sky-600" /> bathroom visits coloured by the bed they&apos;re credited to</span>
              </span>
            </div>
            <Timeline ward={ward} night={lastNight} />
            {lastNight.attributionAccuracy !== null && (
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <Radar className="w-3.5 h-3.5 text-indigo-500" />
                Shared-bathroom visits are credited to the bed someone just left (timing within 6 min, first come first served).
                Last night {lastNight.attributionAccuracy}% were credited to the right person (known only in simulation).
              </p>
            )}
          </section>
        )}

        {ward && reports.length > 0 && (
          <section className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
            <h2 className="font-bold px-5 pt-4">Compared with each resident&apos;s 1-week normal</h2>
            <p className="text-xs text-slate-500 px-5 pb-3">Normal = nights 5–11 ago · Now = last 3 nights · flagged only if the change shows on at least 2 of the 3 nights</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-400 border-y border-slate-100">
                    <th className="px-5 py-2">Bed</th>
                    <th className="px-3 py-2">Sleep</th>
                    <th className="px-3 py-2">Bathroom</th>
                    <th className="px-3 py-2">Bed exits</th>
                    <th className="px-3 py-2">Breathing</th>
                    <th className="px-3 py-2">What it may mean</th>
                  </tr>
                </thead>
                <tbody>
                  {occupied.map((b) => {
                    const rep = reportOf(b.resident!.id);
                    const cell = (key: string) => {
                      const s = rep?.signals.find((x) => x.key === key);
                      if (!s || s.baselineMean === null || s.recentMean === null) return <span className="text-slate-300">–</span>;
                      const unit = key === "sleep_hours" ? " h" : key === "night_breathing" ? "/min" : "";
                      return (
                        <span className={s.severity ? "font-bold text-red-600" : "text-slate-700"}>
                          {s.baselineMean.toFixed(1)} → {s.recentMean.toFixed(1)}
                          {unit}
                        </span>
                      );
                    };
                    const shown = rep?.patterns.slice(0, 2) ?? [];
                    return (
                      <tr key={b.id} className="border-b border-slate-50 align-top">
                        <td className="px-5 py-2.5 font-semibold whitespace-nowrap">
                          <BedDouble className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-slate-400" />
                          {b.label} · {b.resident!.full_name}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{cell("sleep_hours")}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{cell("washroom_visits")}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{cell("night_bed_exits")}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{cell("night_breathing")}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-600 min-w-[220px]">
                          {shown.length ? (
                            shown.map((pattern, k) => (
                              <p key={pattern.id} className={k ? "mt-1" : undefined}>
                                <span className="font-semibold text-slate-900">{pattern.title}.</span> {pattern.actions[0]}.
                              </p>
                            ))
                          ) : (
                            <span className="text-emerald-700">Usual nights</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 px-5 py-3">
              {Object.keys(nightsByBed).length} residents × 14 nights saved. Open{" "}
              <Link href="/staff/early-warning" className="underline">
                Early Warning
              </Link>{" "}
              to see these together with the care-log signals.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
