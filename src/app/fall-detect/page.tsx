"use client";

/**
 * Phone as a stand-in resident: the phone's motion sensor plays the part of
 * the resident. Drop the phone (onto a bed or cushion) and ElderLink treats
 * it as that resident falling: free fall -> impact -> lying still.
 *
 * Flow: fall detected -> 10 s "Are you OK?" on the phone -> fall alert goes
 * live on the staff dashboard (alarm, "I'm going", red-flag check). Staff
 * tell the family from the alert after checking the resident.
 *
 * Needs HTTPS on phones (browsers only share motion data with secure pages):
 * run `npm run dev:phone` locally, or use the deployed https site.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Loader2, Lock, Smartphone, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { newDetector, step, type FallDetector } from "@/lib/sensors/phone-fall";

type Resident = { id: string; full_name: string; room_number: string | null };
type Phase = "setup" | "watching" | "countdown" | "sending" | "sent" | "safe";

const CONFIRM_S = 10;
const HISTORY = 120; // samples in the live graph (~2-4 s)

type MotionCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export default function PhoneFallPage() {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentId, setResidentId] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [secure, setSecure] = useState(true);
  const [phase, setPhase] = useState<Phase>("setup");
  const [g, setG] = useState<number | null>(null);
  const [detectorPhase, setDetectorPhase] = useState<FallDetector["phase"]>("idle");
  const [noData, setNoData] = useState(false);
  const [countdown, setCountdown] = useState(CONFIRM_S);
  const [message, setMessage] = useState<string | null>(null);
  const [peak, setPeak] = useState(0);

  const detector = useRef<FallDetector>(newDetector());
  const history = useRef<number[]>([]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const gotData = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const phaseRef = useRef<Phase>("setup");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const resident = residents.find((r) => r.id === residentId) ?? null;

  // ── residents + secure context ───────────────────────────────────────
  useEffect(() => {
    void (async () => {
      setSecure(window.isSecureContext);
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setNeedsLogin(true);
        return;
      }
      const { data: rows } = await supabase
        .from("residents")
        .select("id, full_name, room_number")
        .eq("status", "active")
        .order("full_name");
      setResidents((rows ?? []) as Resident[]);
      if (rows?.[0]) setResidentId(rows[0].id);
    })();
  }, []);

  // ── live graph ───────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    const max = 4;
    ctx.clearRect(0, 0, w, h);
    const y = (v: number) => h - (Math.min(v, max) / max) * h;
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (const lvl of [1, 2, 3]) {
      ctx.beginPath();
      ctx.moveTo(0, y(lvl));
      ctx.lineTo(w, y(lvl));
      ctx.stroke();
    }
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px sans-serif";
    ctx.fillText("1 g (still)", 4, y(1) - 3);
    ctx.fillText("2 g", 4, y(2) - 3);
    const pts = history.current;
    ctx.strokeStyle = "#357366";
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((v, i) => {
      const x = (i / (HISTORY - 1)) * w;
      if (i === 0) ctx.moveTo(x, y(v));
      else ctx.lineTo(x, y(v));
    });
    ctx.stroke();
  }, []);

  // ── raise the alert ──────────────────────────────────────────────────
  const sendAlert = useCallback(
    async (how: "detected" | "manual") => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setPhase("sending");
      const supabase = createClient();
      const deviceId = "PHONE-SIM";
      const { error } = await supabase.from("fall_events").insert({
        device_id: deviceId,
        resident_id: residentId || null,
        status: "unresolved",
        z_drop: Number(peak.toFixed(2)) || null,
        doppler_spike: 0,
      });
      await supabase.from("sensor_events").insert({
        source: "simulated_sensor",
        sensor_type: "phone_accelerometer",
        device_id: deviceId,
        room: resident?.room_number ?? null,
        resident_id: residentId || null,
        event_type: "fall_confirmed",
        status: "alert",
        payload: { how, peak_g: Number(peak.toFixed(2)) },
      });
      if (navigator.vibrate) navigator.vibrate(0);
      setPhase("sent");
      setMessage(
        error
          ? `Fall detected, but the alert could not be saved: ${error.message}`
          : `Fall alert is live on the staff dashboard for ${resident?.full_name ?? "this resident"}. Staff will respond and tell the family after checking.`
      );
    },
    [peak, resident, residentId]
  );

  const startCountdown = useCallback(() => {
    if (phaseRef.current !== "watching") return;
    phaseRef.current = "countdown"; // immediately, so later readings can't start a second countdown
    setPhase("countdown");
    setCountdown(CONFIRM_S);
    // Bring the big "Are you OK?" panel into view on the phone.
    setTimeout(() => document.getElementById("fall-countdown")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]);
    let left = CONFIRM_S;
    timer.current = setInterval(() => {
      left -= 1;
      setCountdown(left);
      if (navigator.vibrate && left > 0) navigator.vibrate(300);
      if (left <= 0) void sendAlert("detected");
    }, 1000);
  }, [sendAlert]);

  // ── motion events ────────────────────────────────────────────────────
  const onMotion = useCallback(
    (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      gotData.current = true;
      const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) / 9.81;
      setG(mag);
      history.current = [...history.current.slice(-(HISTORY - 1)), mag];
      draw();
      if (phaseRef.current !== "watching") return;
      const next = step(detector.current, mag, performance.now());
      if (next.phase !== detector.current.phase) setDetectorPhase(next.phase);
      if (next.peakG) setPeak((p) => Math.max(p, next.peakG));
      detector.current = next;
      if (next.phase === "fall") startCountdown();
    },
    [draw, startCountdown]
  );

  // One stable listener that always calls the latest handler, so we can
  // add/remove it reliably and the effect below only runs on unmount.
  const onMotionRef = useRef(onMotion);
  useEffect(() => {
    onMotionRef.current = onMotion;
  }, [onMotion]);
  const listener = useRef((e: DeviceMotionEvent) => onMotionRef.current(e));

  async function start() {
    setMessage(null);
    // Without a usable motion sensor (laptop, denied permission) we still
    // watch in "simulate only" mode so the demo button works.
    let sensor = true;
    const Ctor = (typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : undefined) as MotionCtor | undefined;
    if (!Ctor) {
      sensor = false;
    } else if (typeof Ctor.requestPermission === "function") {
      try {
        sensor = (await Ctor.requestPermission()) === "granted";
      } catch {
        sensor = false;
      }
    }
    detector.current = newDetector();
    setDetectorPhase("idle");
    setPeak(0);
    gotData.current = false;
    setNoData(!sensor);
    if (sensor) window.addEventListener("devicemotion", listener.current);
    phaseRef.current = "watching";
    setPhase("watching");
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
      wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
    } catch {
      /* screen may sleep; keep it awake manually */
    }
    if (sensor) {
      setTimeout(() => {
        if (!gotData.current) setNoData(true);
      }, 2500);
    }
  }

  const stop = useCallback(() => {
    window.removeEventListener("devicemotion", listener.current);
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (navigator.vibrate) navigator.vibrate(0);
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setPhase("setup");
    setG(null);
    setDetectorPhase("idle");
  }, []);

  // Unmount only: release the sensor, timers and screen lock.
  useEffect(() => {
    const l = listener.current;
    return () => {
      window.removeEventListener("devicemotion", l);
      if (timer.current) clearInterval(timer.current);
      if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(0);
      void wakeLock.current?.release().catch(() => {});
    };
  }, []);

  function imOk() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (navigator.vibrate) navigator.vibrate(0);
    setPhase("safe");
    setMessage("You said you're OK, so no alert was sent.");
  }

  function watchAgain() {
    phaseRef.current = "watching";
    detector.current = newDetector();
    setDetectorPhase("idle");
    setPeak(0);
    setMessage(null);
    setPhase("watching");
  }

  // ── UI ───────────────────────────────────────────────────────────────
  if (needsLogin) {
    return (
      <Center>
        <p className="font-bold">Sign in to use the phone fall sensor</p>
        <p className="text-sm text-slate-500">The phone must be signed in with a staff account to raise alerts.</p>
        <Link href="/login" className="block bg-[#357366] text-white font-bold py-3 rounded-2xl">
          Staff sign in
        </Link>
      </Center>
    );
  }

  const stateLabel =
    detectorPhase === "freefall" ? "Falling…" : detectorPhase === "impact" ? "Impact – checking if they get up" : detectorPhase === "fall" ? "Fall" : "Normal";

  return (
    <div className="min-h-screen bg-[#F6F7F5] text-slate-900">
      <header className="bg-white border-b border-slate-100">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/staff/dashboard" className="p-2 -ml-2 rounded-xl hover:bg-slate-100" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <span className="font-bold">Phone fall sensor</span>
          <span className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
            Simulation
          </span>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-5 space-y-4">
        {!secure && (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-900 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <Lock className="w-4 h-4" /> Needs a secure (https) address
            </p>
            <p>
              Phones only share motion data with https pages, so nothing will be detected on this address. On the laptop,
              stop the dev server and run <code className="font-mono bg-white px-1 rounded">npm run dev:phone</code>, then
              open <span className="font-mono">https://&lt;laptop-wifi-address&gt;:3000/fall-detect</span> on the phone and
              accept the certificate warning (Advanced → Proceed). Or use the deployed https site.
            </p>
          </div>
        )}

        {/* Setup */}
        <section className="bg-white rounded-3xl border border-slate-100 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-[#EAF4F1] text-[#357366]">
              <Smartphone className="w-5 h-5" />
            </div>
            <p className="text-sm text-slate-600">
              This phone plays the part of a resident. <strong>Drop it onto a bed or cushion</strong>: a fall, an impact,
              then lying still for 1.5 s counts as a fall. Shaking or walking doesn&apos;t.
            </p>
          </div>
          <label className="block text-sm font-semibold" htmlFor="resident">
            The phone is…
          </label>
          <select
            id="resident"
            value={residentId}
            onChange={(e) => setResidentId(e.target.value)}
            disabled={phase !== "setup"}
            className="w-full border border-slate-200 rounded-xl px-3 py-3 bg-white"
          >
            {residents.length === 0 && <option value="">Loading residents…</option>}
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
                {r.room_number ? ` · ${r.room_number}` : ""}
              </option>
            ))}
          </select>
          {phase === "setup" ? (
            <button onClick={start} disabled={!residentId} className="w-full bg-[#357366] text-white font-bold py-3.5 rounded-2xl disabled:opacity-40">
              Start watching
            </button>
          ) : (
            <button onClick={stop} className="w-full border border-slate-300 bg-white font-bold py-3 rounded-2xl">
              Stop
            </button>
          )}
        </section>

        {/* Live */}
        {phase !== "setup" && (
          <section className="bg-white rounded-3xl border border-slate-100 p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-bold">{resident?.full_name}</span>
              <span className="font-mono">{g != null ? `${g.toFixed(2)} g` : "—"}</span>
            </div>
            <canvas ref={canvas} width={360} height={110} className="w-full h-[110px] rounded-xl bg-slate-50" />
            <p className={`text-sm font-semibold ${detectorPhase === "idle" ? "text-emerald-700" : "text-amber-700"}`}>{stateLabel}</p>
            {noData && (
              <p className="text-xs text-red-700">
                No motion sensor data here (laptops have none, or permission was refused).{" "}
                {secure ? "On a phone use Chrome (Android) or Safari (iPhone) and allow motion." : "Open it on an https address (see above)."} You
                can still use the button below.
              </p>
            )}
            {phase === "watching" && (
              <button onClick={() => startCountdown()} className="w-full border-2 border-red-500 text-red-600 font-bold py-2.5 rounded-2xl text-sm">
                Simulate a fall without dropping
              </button>
            )}
          </section>
        )}

        {phase === "countdown" && (
          <section id="fall-countdown" className="rounded-3xl bg-red-600 text-white p-5 text-center space-y-3" role="alertdialog" aria-label="Fall detected">
            <TriangleAlert className="w-10 h-10 mx-auto" />
            <p className="text-2xl font-black">Fall detected</p>
            <p className="text-white/90">{resident?.full_name}, are you OK?</p>
            <p className="text-6xl font-black tabular-nums">{countdown}</p>
            <p className="text-sm text-white/80">Staff will be alerted when this reaches 0.</p>
            <button onClick={imOk} className="w-full bg-white text-emerald-700 font-black py-4 rounded-2xl text-lg">
              I&apos;m OK
            </button>
            <button onClick={() => void sendAlert("manual")} className="w-full bg-red-800 font-bold py-3 rounded-2xl">
              Get help now
            </button>
          </section>
        )}

        {phase === "sending" && (
          <Center inline>
            <Loader2 className="w-6 h-6 animate-spin text-red-600 mx-auto" />
            <p className="font-semibold">Alerting staff…</p>
          </Center>
        )}

        {(phase === "sent" || phase === "safe") && message && (
          <section
            className={`rounded-3xl p-5 space-y-3 ${phase === "sent" ? "bg-emerald-50 border border-emerald-200" : "bg-sky-50 border border-sky-200"}`}
          >
            <p className="flex items-start gap-2 text-sm font-semibold">
              <CheckCircle2 className="w-5 h-5 shrink-0" /> {message}
            </p>
            <button onClick={watchAgain} className="w-full bg-white border border-slate-200 font-bold py-3 rounded-2xl">
              Keep watching
            </button>
          </section>
        )}

        {message && phase === "setup" && <p className="text-sm text-red-700">{message}</p>}
      </main>
    </div>
  );
}

function Center({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return (
    <div className={inline ? "py-6" : "min-h-screen flex items-center justify-center bg-[#F6F7F5] p-6"}>
      <div className="bg-white rounded-3xl border border-slate-100 p-6 max-w-sm w-full text-center space-y-3 mx-auto">{children}</div>
    </div>
  );
}
