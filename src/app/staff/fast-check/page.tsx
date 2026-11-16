"use client";

/**
 * BE-FAST stroke check: a guided, one-question-per-screen flow for carers.
 *
 *   Who & when → Balance → Eyes → Face → Arms (phone-measured) → Speech → Result
 *
 * - Large answer buttons; answering moves to the next step automatically.
 * - The moment any sign is positive, a red "Call 108" banner stays on screen.
 * - Optional read-aloud instructions in English or Hindi (browser voices).
 * - The arm test shows a live tilt gauge; a clearly labelled SIMULATED
 *   practice mode works on laptops without a motion sensor.
 *
 * It does not diagnose. Positive checks are saved to fast_checks and can
 * raise an emergency alert (optionally texting the family).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Brain,
  Check,
  ChevronLeft,
  Clock,
  Eye,
  FlaskConical,
  Loader2,
  Mic,
  Phone,
  Smartphone,
  Smile,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  angleFrom,
  ARM_TEST_MS,
  assessArms,
  DRIFT_DEG,
  evaluateFast,
  formatDuration,
  SETTLE_MS,
  simulateHold,
  tiltChangeDeg,
  type FastAnswers,
  type MotionSample,
} from "@/lib/fast/fast";

type Resident = { id: string; full_name: string; room_number: string | null };
type YesNo = boolean | null;
type SignKey = "balance" | "eyes" | "face" | "arms" | "speech";
type Lang = "en-IN" | "hi-IN";

const SIGN_STEPS: {
  key: SignKey;
  letter: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  en: string;
  hi: string;
  yes: string;
  no: string;
}[] = [
  {
    key: "balance",
    letter: "B",
    title: "Balance",
    icon: Activity,
    en: "Has there been a sudden loss of balance, dizziness or trouble walking?",
    hi: "क्या अचानक संतुलन बिगड़ा, चक्कर आए या चलने में दिक्कत हुई?",
    yes: "Yes, sudden",
    no: "No",
  },
  {
    key: "eyes",
    letter: "E",
    title: "Eyes",
    icon: Eye,
    en: "Any sudden blurred, double or lost vision in one or both eyes?",
    hi: "क्या अचानक धुंधला दिखना, दो-दो दिखना या नज़र जाना हुआ?",
    yes: "Yes",
    no: "No",
  },
  {
    key: "face",
    letter: "F",
    title: "Face",
    icon: Smile,
    en: "Ask them to smile and show their teeth. Does one side of the face droop?",
    hi: "उन्हें मुस्कुराने को कहें। क्या चेहरे का एक तरफ़ लटक रहा है?",
    yes: "One side droops",
    no: "Even smile",
  },
  {
    key: "arms",
    letter: "A",
    title: "Arms",
    icon: Activity,
    en: "Both arms straight out, palms up, eyes closed, for ten seconds. Does one arm drift down or turn over?",
    hi: "दोनों हाथ सामने सीधे फैलाएँ, हथेलियाँ ऊपर, आँखें बंद, दस सेकंड तक। क्या एक हाथ नीचे गिरता है?",
    yes: "Drifts / weak",
    no: "Both steady",
  },
  {
    key: "speech",
    letter: "S",
    title: "Speech",
    icon: Mic,
    en: "Ask them to repeat: Today is a sunny day. Is the speech slurred, muddled, or are they unable to speak?",
    hi: "उनसे दोहराने को कहें: आज धूप वाला दिन है। क्या बोली लड़खड़ा रही है या बोल नहीं पा रहे?",
    yes: "Slurred / wrong",
    no: "Clear",
  },
];

const TOTAL_STEPS = SIGN_STEPS.length + 2; // who/when + signs + result

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function speak(text: string, lang: Lang) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.92;
  window.speechSynthesis.speak(u);
}

/* ------------------------------------------------------------------ */
/* Arm test: live gauge + optional simulated practice                  */
/* ------------------------------------------------------------------ */

type ArmSide = "left" | "right";

function TiltGauge({ deg }: { deg: number }) {
  const max = 30;
  const pct = Math.min(deg, max) / max;
  const over = deg >= DRIFT_DEG;
  return (
    <div className="space-y-1">
      <div className="relative h-4 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-150 ${over ? "bg-red-500" : "bg-teal-500"}`}
          style={{ width: `${pct * 100}%` }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-slate-700" style={{ left: `${(DRIFT_DEG / max) * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-500">
        <span>0°</span>
        <span>drift line {DRIFT_DEG}°</span>
        <span>{max}°+</span>
      </div>
    </div>
  );
}

function ArmTest({
  leftDeg,
  rightDeg,
  onMeasured,
}: {
  leftDeg: number | null;
  rightDeg: number | null;
  onMeasured: (side: ArmSide, deg: number | null, simulated: boolean) => void;
}) {
  const [running, setRunning] = useState<ArmSide | null>(null);
  const [phase, setPhase] = useState<"ready" | "hold">("ready");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [liveDeg, setLiveDeg] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [simulatedUsed, setSimulatedUsed] = useState(false);
  const samples = useRef<MotionSample[]>([]);
  const handler = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  const stop = () => {
    if (handler.current) window.removeEventListener("devicemotion", handler.current);
    handler.current = null;
  };
  useEffect(() => stop, []);

  const countdown = async (secs: number) => {
    for (let s = secs; s > 0; s--) {
      setSecondsLeft(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
  };

  const measure = async (side: ArmSide) => {
    setMsg(null);
    const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DME) {
      setMsg("No motion sensor on this device. Use the practice mode below or judge by eye.");
      return;
    }
    if (DME.requestPermission) {
      try {
        if ((await DME.requestPermission()) !== "granted") {
          setMsg("Motion sensor permission was refused. Judge the arms by eye instead.");
          return;
        }
      } catch {
        setMsg("Could not access the motion sensor. Judge the arms by eye instead.");
        return;
      }
    }

    setRunning(side);
    setLiveDeg(0);
    setPhase("ready");
    await countdown(3);

    samples.current = [];
    let t0: number | null = null;
    let ref: { x: number; y: number; z: number } | null = null;
    let lastUi = 0;
    handler.current = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null || g.z == null) return;
      if (t0 === null) t0 = e.timeStamp;
      const t = e.timeStamp - t0;
      const s = { t, x: g.x, y: g.y, z: g.z };
      samples.current.push(s);
      if (!ref && t >= SETTLE_MS) ref = { x: g.x, y: g.y, z: g.z };
      if (ref && e.timeStamp - lastUi > 120) {
        lastUi = e.timeStamp;
        setLiveDeg(angleFrom(ref, s));
      }
    };
    window.addEventListener("devicemotion", handler.current);
    setPhase("hold");
    await countdown(ARM_TEST_MS / 1000);
    stop();
    const deg = tiltChangeDeg(samples.current);
    if (deg === null) setMsg("No motion data was received. Use practice mode or judge this arm by eye.");
    onMeasured(side, deg, false);
    setRunning(null);
  };

  /** SIMULATED: left arm drifts ~24°, right stays steady. */
  const practice = async () => {
    setMsg(null);
    setSimulatedUsed(true);
    for (const [side, drift] of [["left", 24], ["right", 3]] as const) {
      setRunning(side);
      setPhase("hold");
      const sim = simulateHold(drift, side === "left" ? 3 : 5);
      for (let i = 0; i <= 10; i++) {
        setSecondsLeft(10 - i);
        const sample = sim[Math.min(sim.length - 1, Math.round((i / 10) * (sim.length - 1)))];
        setLiveDeg(angleFrom(sim[Math.round(SETTLE_MS / 50)], sample));
        await new Promise((r) => setTimeout(r, 180));
      }
      onMeasured(side, tiltChangeDeg(sim), true);
    }
    setRunning(null);
  };

  const box = (side: ArmSide, deg: number | null) => (
    <button
      type="button"
      disabled={running !== null}
      onClick={() => measure(side)}
      className={`flex-1 rounded-2xl border-2 p-4 text-left disabled:opacity-60 transition-all ${
        running === side ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{side} arm</div>
      <div className={`text-2xl font-black ${deg !== null && deg >= DRIFT_DEG ? "text-red-600" : "text-slate-900"}`}>
        {deg === null ? "—" : `${deg}°`}
      </div>
      <div className="text-[11px] text-teal-700 font-semibold">{deg === null ? "Tap to measure" : "Tap to repeat"}</div>
    </button>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 flex gap-2">
        <Smartphone className="w-4 h-4 shrink-0 mt-0.5 text-slate-400" />
        Place the phone flat on one palm, screen up. Arm straight out, eyes closed. The phone measures how far it tilts
        in 10 seconds. Then do the other arm.
      </p>
      <div className="flex gap-2">
        {box("left", leftDeg)}
        {box("right", rightDeg)}
      </div>
      {running && (
        <div className={`rounded-2xl p-3 space-y-2 ${phase === "ready" ? "bg-amber-50" : "bg-teal-50"}`}>
          <p className={`text-sm font-bold text-center ${phase === "ready" ? "text-amber-800" : "text-teal-800"}`}>
            {phase === "ready" ? `Get ready: ${running} arm out, eyes closed… ${secondsLeft}` : `${running} arm: hold still… ${secondsLeft}s`}
          </p>
          {phase === "hold" && <TiltGauge deg={liveDeg} />}
        </div>
      )}
      <button
        type="button"
        onClick={practice}
        disabled={running !== null}
        className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-700 bg-indigo-50/50 disabled:opacity-50"
      >
        <FlaskConical className="w-3.5 h-3.5" /> Practice with a SIMULATED arm test (no sensor needed)
      </button>
      {simulatedUsed && (
        <p className="text-[11px] text-indigo-700">
          Simulated readings shown. Do not use them for a real resident; measure with the phone or judge by eye.
        </p>
      )}
      {msg && <p className="text-xs text-amber-800">{msg}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Optional speech recording (kept in memory only)                     */
/* ------------------------------------------------------------------ */

function SpeechSample() {
  const [recording, setRecording] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );

  const start = async () => {
    setMsg(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setUrl(URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" })));
        setRecording(false);
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setTimeout(() => rec.state === "recording" && rec.stop(), 15_000);
    } catch {
      setMsg("Microphone not available. Listen and judge by ear.");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!recording ? (
        <button type="button" onClick={start} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white">
          <Mic className="w-3.5 h-3.5 text-teal-600" /> {url ? "Record again" : "Record a sample for the nurse (optional)"}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => recRef.current?.stop()}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 animate-pulse"
        >
          <Square className="w-3.5 h-3.5" /> Stop recording
        </button>
      )}
      {url && <audio src={url} controls className="h-9" />}
      <span className="text-[11px] text-slate-400">Stays on this phone only.</span>
      {msg && <p className="text-xs text-amber-800 w-full">{msg}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function FastCheckPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [residentId, setResidentId] = useState("");
  const [lkwInput, setLkwInput] = useState("");
  const [lastLogAt, setLastLogAt] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<SignKey, YesNo>>({
    balance: null,
    eyes: null,
    face: null,
    arms: null,
    speech: null,
  });
  const [leftDeg, setLeftDeg] = useState<number | null>(null);
  const [rightDeg, setRightDeg] = useState<number | null>(null);
  const [armsSimulated, setArmsSimulated] = useState(false);
  const [notes, setNotes] = useState("");

  const [readAloud, setReadAloud] = useState(false);
  const [lang, setLang] = useState<Lang>("en-IN");

  const [ambulanceCalled, setAmbulanceCalled] = useState(false);
  const [notifyFamily, setNotifyFamily] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void (async () => {
      const supabase = createClient();
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
      setIsStaff(Boolean(staffRow));
      setResidents((rows as Resident[]) ?? []);
      const pre = new URLSearchParams(window.location.search).get("resident");
      if (pre && (rows ?? []).some((r) => r.id === pre)) setResidentId(pre);
      setLkwInput(toLocalInput(new Date()));
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), 15_000);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [router]);

  const loadLastLog = useCallback(async (id: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from("care_logs_demo")
      .select("created_at")
      .eq("resident_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    setLastLogAt(data?.[0]?.created_at ?? null);
  }, []);

  useEffect(() => {
    if (!residentId) return;
    void (async () => {
      await loadLastLog(residentId);
    })();
  }, [residentId, loadLastLog]);

  const lastKnownWell = lkwInput ? new Date(lkwInput).toISOString() : new Date(now || 0).toISOString();
  const fastAnswers: FastAnswers = { ...answers, lastKnownWell };
  const outcome = now ? evaluateFast(fastAnswers, new Date(now)) : null;
  const resident = residents.find((r) => r.id === residentId) ?? null;
  const positive = outcome?.status === "positive";
  const armResult = assessArms(leftDeg, rightDeg);

  /* ---- navigation ---------------------------------------------------- */

  const instructionFor = (s: number) => {
    if (s >= 1 && s <= SIGN_STEPS.length) {
      const cfg = SIGN_STEPS[s - 1];
      return lang === "hi-IN" ? cfg.hi : cfg.en;
    }
    return null;
  };

  const goTo = (s: number) => {
    const next = Math.max(0, Math.min(TOTAL_STEPS - 1, s));
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
    const text = instructionFor(next);
    if (readAloud && text) speak(text, lang);
  };

  const answer = (key: SignKey, v: YesNo) => {
    setAnswers((prev) => ({ ...prev, [key]: v }));
    // Auto-advance after a short pause so the choice is visible. The target
    // comes from the question answered (not the current step), so a quick
    // double-tap can never skip a question.
    const target = SIGN_STEPS.findIndex((s) => s.key === key) + 2;
    setTimeout(() => goTo(target), 280);
  };

  const onArmMeasured = (side: ArmSide, deg: number | null, simulated: boolean) => {
    const l = side === "left" ? deg : leftDeg;
    const r = side === "right" ? deg : rightDeg;
    if (side === "left") setLeftDeg(deg);
    else setRightDeg(deg);
    if (simulated) setArmsSimulated(true);
    const res = assessArms(l, r);
    if (res.drift !== null) setAnswers((prev) => ({ ...prev, arms: res.drift }));
  };

  /* ---- save ---------------------------------------------------------- */

  const save = async (raiseAlert: boolean) => {
    if (!resident || !outcome) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session has expired. Please sign in again.");

      const noteParts = [notes.trim(), armsSimulated ? "[Arm test used SIMULATED practice readings]" : ""].filter(Boolean);
      const { error: insErr } = await supabase.from("fast_checks").insert({
        resident_id: resident.id,
        performed_by: auth.user.id,
        last_known_well: lastKnownWell,
        ...answers,
        arm_left_deg: armsSimulated ? null : leftDeg,
        arm_right_deg: armsSimulated ? null : rightDeg,
        outcome: outcome.status,
        ambulance_called: ambulanceCalled,
        notes: noteParts.join(" ") || null,
      });
      if (insErr) throw new Error(`Could not save the check: ${insErr.message}`);

      let alertMsg = "";
      if (raiseAlert) {
        let recorded = false;
        if (notifyFamily) {
          const res = await fetch("/api/emergency-alert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ residentId: resident.id, alertType: "suspected stroke", channels: ["sms"] }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok) {
            recorded = Boolean(json.recorded);
            alertMsg = json.sentChannels?.length
              ? " Family notified by SMS."
              : ` Family not reached${json.failures?.[0]?.reason ? `: ${json.failures[0].reason}` : "."}`;
          } else {
            alertMsg = ` Family not notified (${json.error ?? "SOS service unavailable"}).`;
          }
        }
        if (!recorded) {
          const { error: aErr } = await supabase.from("emergency_alerts").insert({
            resident_id: resident.id,
            type: "suspected stroke",
            status: "open",
            raised_by: isStaff ? auth.user.id : null,
          });
          if (aErr) alertMsg += ` Emergency alert could not be recorded: ${aErr.message}.`;
        }
      }
      setSaved(
        `Check saved for ${resident.full_name}.${raiseAlert ? " Stroke alert raised; it shows on the dashboard and in the handover." : ""}${alertMsg}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const signCfg = step >= 1 && step <= SIGN_STEPS.length ? SIGN_STEPS[step - 1] : null;
  const isResult = step === TOTAL_STEPS - 1;
  const btn = (active: boolean, cls: string) =>
    `w-full py-5 rounded-2xl text-lg font-black border-2 transition-all active:scale-[0.98] ${active ? cls : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"}`;

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-slate-900">
      {/* Header: progress, timer, 108 */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#FAFAF8]/95 border-b border-slate-100">
        <div className="max-w-xl mx-auto px-4 pt-3 pb-2 space-y-2">
          <div className="flex items-center gap-2">
            <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="p-2 rounded-xl bg-rose-50 text-rose-700">
              <Brain className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-bold leading-tight">Stroke check</h1>
              <p className="text-[11px] text-slate-500">BE-FAST screening guide, not a diagnosis</p>
            </div>
            <a
              href="tel:108"
              onClick={() => setAmbulanceCalled(true)}
              className="ml-auto inline-flex items-center gap-1.5 bg-red-600 text-white text-sm font-black px-3.5 py-2 rounded-xl"
            >
              <Phone className="w-4 h-4" /> 108
            </a>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex gap-1" aria-label={`Step ${step + 1} of ${TOTAL_STEPS}`}>
              {Array.from({ length: TOTAL_STEPS }, (_, i) => {
                const key = i >= 1 && i <= SIGN_STEPS.length ? SIGN_STEPS[i - 1].key : null;
                const v = key ? answers[key] : null;
                return (
                  <button
                    key={i}
                    onClick={() => goTo(i)}
                    aria-label={`Go to step ${i + 1}`}
                    className={`h-2 flex-1 rounded-full ${
                      i === step ? "bg-slate-900" : v === true ? "bg-red-500" : v === false ? "bg-emerald-500" : i < step ? "bg-slate-400" : "bg-slate-200"
                    }`}
                  />
                );
              })}
            </div>
            {outcome && (
              <span className="text-[11px] font-semibold text-slate-600 inline-flex items-center gap-1 shrink-0">
                <Clock className="w-3 h-3" /> {formatDuration(outcome.minutesSinceLastWell)}
              </span>
            )}
          </div>
        </div>
        {positive && !isResult && (
          <div className="bg-red-600 text-white">
            <div className="max-w-xl mx-auto px-4 py-2 flex items-center gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="font-bold">Possible stroke ({outcome!.signs.join(", ")}). Call 108 now.</span>
              <button onClick={() => goTo(TOTAL_STEPS - 1)} className="ml-auto underline font-semibold shrink-0">
                What to do →
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-xl mx-auto px-4 py-5 space-y-4">
        {/* Read-aloud controls */}
        <div className="flex items-center justify-end gap-2 text-xs">
          <button
            onClick={() => {
              const on = !readAloud;
              setReadAloud(on);
              const text = instructionFor(step);
              if (on && text) speak(text, lang);
              if (!on && "speechSynthesis" in window) window.speechSynthesis.cancel();
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold ${readAloud ? "bg-teal-600 text-white border-teal-600" : "bg-white border-slate-200 text-slate-600"}`}
            aria-pressed={readAloud}
          >
            {readAloud ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />} Read aloud
          </button>
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="border border-slate-200 rounded-lg px-2 py-1.5 bg-white"
            aria-label="Instruction language"
          >
            <option value="en-IN">English</option>
            <option value="hi-IN">हिन्दी</option>
          </select>
        </div>

        {/* STEP 0: who & when */}
        {step === 0 && (
          <section className="bg-white rounded-3xl border border-slate-100 p-5 space-y-4 shadow-xs">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-rose-600">Step 1 · Who and when</p>
              <h2 className="text-xl font-black mt-1">Who are you checking?</h2>
            </div>
            <select
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
              className="w-full border-2 border-slate-200 rounded-2xl px-3 py-3.5 text-base"
              aria-label="Resident"
            >
              <option value="">Choose resident…</option>
              {residents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                  {r.room_number ? ` · ${r.room_number}` : ""}
                </option>
              ))}
            </select>

            <div>
              <h3 className="font-bold flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-slate-400" /> When were they last seen completely normal?
              </h3>
              <p className="text-xs text-slate-500 mb-2">
                Not when the symptoms were noticed. Hospitals need this time to decide on treatment.
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="datetime-local"
                  value={lkwInput}
                  onChange={(e) => setLkwInput(e.target.value)}
                  className="border-2 border-slate-200 rounded-xl px-3 py-2 text-sm"
                  aria-label="Last known well"
                />
                {lastLogAt && (
                  <button
                    type="button"
                    onClick={() => setLkwInput(toLocalInput(new Date(lastLogAt)))}
                    className="text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 bg-slate-50"
                  >
                    At last care log ({new Date(lastLogAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })})
                  </button>
                )}
              </div>
            </div>

            <button
              onClick={() => goTo(1)}
              disabled={!residentId}
              className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-lg disabled:opacity-40"
            >
              Start check →
            </button>
          </section>
        )}

        {/* STEPS 1–5: one sign per screen */}
        {signCfg && (
          <section className="bg-white rounded-3xl border border-slate-100 p-5 space-y-4 shadow-xs">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 shrink-0 rounded-2xl bg-rose-50 text-rose-700 text-2xl font-black flex items-center justify-center">
                {signCfg.letter}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-rose-600">
                  Step {step + 1} of {TOTAL_STEPS} · {signCfg.title}
                </p>
                <h2 className="text-lg font-bold leading-snug mt-0.5">{signCfg.en}</h2>
                {lang === "hi-IN" && <p className="text-base text-slate-600 mt-1">{signCfg.hi}</p>}
              </div>
            </div>

            {signCfg.key === "arms" && (
              <>
                <ArmTest leftDeg={leftDeg} rightDeg={rightDeg} onMeasured={onArmMeasured} />
                {(leftDeg !== null || rightDeg !== null) && (
                  <p className={`text-sm rounded-xl px-3 py-2 ${armResult.drift ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"}`}>
                    {armResult.explanation}
                  </p>
                )}
                <p className="text-xs font-semibold text-slate-500">Your judgement (you can override the phone):</p>
              </>
            )}
            {signCfg.key === "speech" && <SpeechSample />}

            <div className="grid gap-2">
              <button type="button" onClick={() => answer(signCfg.key, true)} className={btn(answers[signCfg.key] === true, "bg-red-600 text-white border-red-600")}>
                {signCfg.yes}
              </button>
              <button type="button" onClick={() => answer(signCfg.key, false)} className={btn(answers[signCfg.key] === false, "bg-emerald-600 text-white border-emerald-600")}>
                {signCfg.no}
              </button>
              <button type="button" onClick={() => answer(signCfg.key, null)} className="text-sm text-slate-500 py-2">
                Can&apos;t check this → skip
              </button>
            </div>

            <button onClick={() => goTo(step - 1)} className="inline-flex items-center gap-1 text-sm text-slate-500">
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
          </section>
        )}

        {/* RESULT */}
        {isResult && outcome && (
          <section
            className={`rounded-3xl border p-5 space-y-4 shadow-xs ${
              positive ? "bg-red-600 text-white border-red-700" : outcome.status === "negative" ? "bg-white border-emerald-200" : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-start gap-3">
              {positive ? (
                <AlertTriangle className="w-8 h-8 shrink-0" />
              ) : outcome.status === "negative" ? (
                <Check className="w-8 h-8 text-emerald-600 shrink-0" />
              ) : (
                <Clock className="w-8 h-8 text-slate-400 shrink-0" />
              )}
              <div>
                <h2 className="text-xl font-black leading-tight">{outcome.headline}</h2>
                {resident && <p className={positive ? "text-red-100 text-sm" : "text-slate-500 text-sm"}>{resident.full_name}</p>}
              </div>
            </div>

            {positive && (
              <div className="flex flex-wrap gap-1.5">
                {outcome.signs.map((s) => (
                  <span key={s} className="text-xs font-bold bg-white/15 border border-white/30 px-2 py-1 rounded-lg">
                    {s}
                  </span>
                ))}
              </div>
            )}
            {outcome.timeMessage && <p className={`text-sm ${positive ? "text-red-50" : "text-slate-600"}`}>{outcome.timeMessage}</p>}

            <ol className={`text-sm space-y-1.5 list-decimal pl-5 ${positive ? "text-white" : "text-slate-700"}`}>
              {outcome.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ol>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Notes: what prompted the check? e.g. found confused at 14:10, left hand weak"
              className="w-full rounded-2xl p-3 text-sm text-slate-900 border border-slate-200"
              aria-label="Notes"
            />

            {saved ? (
              <p className={`text-sm font-semibold ${positive ? "text-white" : "text-emerald-700"}`}>✓ {saved}</p>
            ) : positive ? (
              <div className="space-y-2">
                <a
                  href="tel:108"
                  onClick={() => setAmbulanceCalled(true)}
                  className="flex items-center justify-center gap-2 bg-white text-red-700 font-black text-lg py-4 rounded-2xl"
                >
                  <Phone className="w-5 h-5" /> Call 108
                </a>
                <button
                  type="button"
                  disabled={!resident || saving}
                  onClick={() => save(true)}
                  className="w-full flex items-center justify-center gap-2 bg-red-800 text-white font-bold py-3.5 rounded-2xl disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                  Save &amp; raise stroke alert
                </button>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={notifyFamily} onChange={(e) => setNotifyFamily(e.target.checked)} /> Text the family
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={ambulanceCalled} onChange={(e) => setAmbulanceCalled(e.target.checked)} /> Ambulance called
                  </label>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={!resident || saving}
                onClick={() => save(false)}
                className="w-full flex items-center justify-center gap-2 bg-[#357366] text-white font-bold py-3.5 rounded-2xl disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save check
              </button>
            )}
            {error && <p className="text-xs bg-white text-red-700 rounded-lg px-2 py-1">{error}</p>}

            {!saved && (
              <button onClick={() => goTo(1)} className={`text-sm underline ${positive ? "text-red-100" : "text-slate-500"}`}>
                Review answers
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
