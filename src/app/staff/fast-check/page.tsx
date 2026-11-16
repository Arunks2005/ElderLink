"use client";

/**
 * BE-FAST stroke check: a guided, time-critical screen for carers.
 *
 *   Balance · Eyes · Face · Arms (phone-measured drift) · Speech · Time
 *
 * It does not diagnose. Any positive sign says "call 108 now", records the
 * check in fast_checks, and can raise an emergency alert (optionally
 * texting the family through the existing SOS route).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Eye,
  Loader2,
  Mic,
  Phone,
  Smartphone,
  Smile,
  Square,
  Brain,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ARM_TEST_MS,
  assessArms,
  evaluateFast,
  formatDuration,
  tiltChangeDeg,
  type FastAnswers,
  type MotionSample,
} from "@/lib/fast/fast";

type Resident = { id: string; full_name: string; room_number: string | null };
type YesNo = boolean | null;

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ------------------------------------------------------------------ */

function YesNoRow({
  value,
  onChange,
  yesLabel = "Yes",
  noLabel = "No",
}: {
  value: YesNo;
  onChange: (v: YesNo) => void;
  yesLabel?: string;
  noLabel?: string;
}) {
  const btn = (active: boolean, cls: string) =>
    `flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all ${active ? cls : "bg-white text-slate-600 border-slate-200"}`;
  return (
    <div className="flex gap-2">
      <button type="button" onClick={() => onChange(true)} className={btn(value === true, "bg-red-600 text-white border-red-600")}>
        {yesLabel}
      </button>
      <button type="button" onClick={() => onChange(false)} className={btn(value === false, "bg-emerald-600 text-white border-emerald-600")}>
        {noLabel}
      </button>
      <button type="button" onClick={() => onChange(null)} className={btn(value === null, "bg-slate-100 text-slate-700 border-slate-300")}>
        Not checked
      </button>
    </div>
  );
}

function Step({
  icon: Icon,
  letter,
  title,
  how,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  letter: string;
  title: string;
  how: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 space-y-3">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 shrink-0 rounded-xl bg-rose-50 text-rose-700 font-black flex items-center justify-center">{letter}</div>
        <div className="min-w-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-1.5">
            <Icon className="w-4 h-4 text-slate-400" /> {title}
          </h2>
          <p className="text-sm text-slate-600">{how}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Arm drift test using the phone's motion sensor                      */
/* ------------------------------------------------------------------ */

type ArmSide = "left" | "right";

function ArmTest({
  leftDeg,
  rightDeg,
  onMeasured,
}: {
  leftDeg: number | null;
  rightDeg: number | null;
  onMeasured: (side: ArmSide, deg: number | null) => void;
}) {
  const [running, setRunning] = useState<ArmSide | null>(null);
  const [phase, setPhase] = useState<"ready" | "hold">("ready");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const samples = useRef<MotionSample[]>([]);
  const handler = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  const stopListening = () => {
    if (handler.current) window.removeEventListener("devicemotion", handler.current);
    handler.current = null;
  };
  useEffect(() => stopListening, []);

  const run = async (side: ArmSide) => {
    setMsg(null);
    // iOS needs explicit permission, requested from a tap.
    const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (DME?.requestPermission) {
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
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) {
      setMsg("This device has no motion sensor. Judge the arms by eye instead.");
      return;
    }

    setRunning(side);
    setPhase("ready");
    for (let s = 3; s > 0; s--) {
      setSecondsLeft(s);
      await new Promise((r) => setTimeout(r, 1000));
    }

    samples.current = [];
    let t0: number | null = null;
    handler.current = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null || g.z == null) return;
      if (t0 === null) t0 = e.timeStamp;
      samples.current.push({ t: e.timeStamp - t0, x: g.x, y: g.y, z: g.z });
    };
    window.addEventListener("devicemotion", handler.current);
    setPhase("hold");
    for (let s = ARM_TEST_MS / 1000; s > 0; s--) {
      setSecondsLeft(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
    stopListening();
    const deg = tiltChangeDeg(samples.current);
    onMeasured(side, deg);
    if (deg === null) setMsg("No motion data was received. Judge this arm by eye.");
    setRunning(null);
  };

  const box = (side: ArmSide, deg: number | null) => (
    <button
      type="button"
      disabled={running !== null}
      onClick={() => run(side)}
      className="flex-1 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 p-3 text-left disabled:opacity-60"
    >
      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{side} arm</div>
      <div className="text-lg font-black text-slate-900">{deg === null ? "Not measured" : `${deg}° tilt`}</div>
      <div className="text-[11px] text-teal-700 font-semibold">{deg === null ? "Tap to measure" : "Tap to repeat"}</div>
    </button>
  );

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        <Smartphone className="w-3.5 h-3.5 inline -mt-0.5" /> Place the phone flat on the resident&apos;s palm, screen up.
        Ask them to hold the arm straight out and close their eyes. The phone measures how much it tilts in 10 seconds.
        Then do the other arm.
      </p>
      <div className="flex gap-2">
        {box("left", leftDeg)}
        {box("right", rightDeg)}
      </div>
      {running && (
        <div className={`rounded-xl px-3 py-2 text-sm font-bold text-center ${phase === "ready" ? "bg-amber-50 text-amber-800" : "bg-teal-50 text-teal-800"}`}>
          {phase === "ready" ? `Get ready: ${running} arm out, eyes closed… ${secondsLeft}` : `Hold still… ${secondsLeft}s`}
        </div>
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

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

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
          <Mic className="w-3.5 h-3.5 text-teal-600" /> {url ? "Record again" : "Record for the nurse (optional)"}
        </button>
      ) : (
        <button type="button" onClick={() => recRef.current?.stop()} className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 animate-pulse">
          <Square className="w-3.5 h-3.5" /> Stop recording
        </button>
      )}
      {url && <audio src={url} controls className="h-9" />}
      <span className="text-[11px] text-slate-400">Stays on this phone only; not uploaded.</span>
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

  const [balance, setBalance] = useState<YesNo>(null);
  const [eyes, setEyes] = useState<YesNo>(null);
  const [face, setFace] = useState<YesNo>(null);
  const [arms, setArms] = useState<YesNo>(null);
  const [speech, setSpeech] = useState<YesNo>(null);
  const [leftDeg, setLeftDeg] = useState<number | null>(null);
  const [rightDeg, setRightDeg] = useState<number | null>(null);
  const [notes, setNotes] = useState("");

  const [ambulanceCalled, setAmbulanceCalled] = useState(false);
  const [notifyFamily, setNotifyFamily] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auth, residents, preselected resident (?resident=ID) and the clock.
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
      timer = setInterval(() => setNow(Date.now()), 30_000);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [router]);

  // Most recent care log for the chosen resident: a quick "last known well" option.
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

  const armResult = assessArms(leftDeg, rightDeg);
  const onArmMeasured = (side: ArmSide, deg: number | null) => {
    const l = side === "left" ? deg : leftDeg;
    const r = side === "right" ? deg : rightDeg;
    if (side === "left") setLeftDeg(deg);
    else setRightDeg(deg);
    const res = assessArms(l, r);
    if (res.drift !== null) setArms(res.drift);
  };

  const lastKnownWell = lkwInput ? new Date(lkwInput).toISOString() : new Date(now || 0).toISOString();
  const answers: FastAnswers = { balance, eyes, face, arms, speech, lastKnownWell };
  const outcome = now ? evaluateFast(answers, new Date(now)) : null;
  const resident = residents.find((r) => r.id === residentId) ?? null;

  const save = async (raiseAlert: boolean) => {
    if (!resident || !outcome) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Your session has expired. Please sign in again.");

      const { error: insErr } = await supabase.from("fast_checks").insert({
        resident_id: resident.id,
        performed_by: auth.user.id,
        last_known_well: lastKnownWell,
        balance,
        eyes,
        face,
        arms,
        speech,
        arm_left_deg: leftDeg,
        arm_right_deg: rightDeg,
        outcome: outcome.status,
        ambulance_called: ambulanceCalled,
        notes: notes.trim() || null,
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
            recorded = true;
            alertMsg = json.sentChannels?.length ? " Family notified by SMS." : " Alert recorded; the family SMS could not be sent.";
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
      setSaved(`Check saved for ${resident.full_name}.${raiseAlert ? " Stroke alert raised; it now shows on the dashboard and in the handover." : ""}${alertMsg}`);
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

  const positive = outcome?.status === "positive";

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-slate-900 pb-40">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#FAFAF8]/90 border-b border-slate-100">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-rose-50 text-rose-700">
            <Brain className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold leading-tight">Stroke check (BE-FAST)</h1>
            <p className="text-[11px] text-slate-500">Screening guide, not a diagnosis. If in doubt, call 108.</p>
          </div>
          <a
            href="tel:108"
            onClick={() => setAmbulanceCalled(true)}
            className="ml-auto inline-flex items-center gap-1.5 bg-red-600 text-white text-sm font-black px-3.5 py-2 rounded-xl"
          >
            <Phone className="w-4 h-4" /> 108
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-4">
        <section className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5 space-y-3">
          <label className="block text-sm font-bold text-slate-900" htmlFor="resident">
            Resident
          </label>
          <select
            id="resident"
            value={residentId}
            onChange={(e) => setResidentId(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
          >
            <option value="">Choose resident…</option>
            {residents.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
                {r.room_number ? ` · Room ${r.room_number}` : ""}
              </option>
            ))}
          </select>

          <div>
            <label className="block text-sm font-bold text-slate-900 mb-1" htmlFor="lkw">
              <Clock className="w-4 h-4 inline -mt-0.5 text-slate-400" /> Last known well
            </label>
            <p className="text-xs text-slate-500 mb-2">
              When was the resident last seen completely normal? (Not when the symptoms were found.)
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                id="lkw"
                type="datetime-local"
                value={lkwInput}
                onChange={(e) => setLkwInput(e.target.value)}
                className="border border-slate-200 rounded-xl px-3 py-2 text-sm"
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
            {outcome && (
              <p className="text-xs font-semibold text-slate-700 mt-2">
                {formatDuration(outcome.minutesSinceLastWell)} since last known well
              </p>
            )}
          </div>
        </section>

        <Step icon={Activity} letter="B" title="Balance" how="Sudden loss of balance, dizziness or trouble walking?">
          <YesNoRow value={balance} onChange={setBalance} />
        </Step>

        <Step icon={Eye} letter="E" title="Eyes" how="Sudden blurred, double or lost vision in one or both eyes?">
          <YesNoRow value={eyes} onChange={setEyes} />
        </Step>

        <Step icon={Smile} letter="F" title="Face" how="Ask them to smile and show their teeth. Does one side of the face droop?">
          <YesNoRow value={face} onChange={setFace} yesLabel="Droops" noLabel="Even" />
        </Step>

        <Step icon={Activity} letter="A" title="Arms" how="Both arms out straight, palms up, eyes closed for 10 seconds. Does one arm drift down or turn over?">
          <ArmTest leftDeg={leftDeg} rightDeg={rightDeg} onMeasured={onArmMeasured} />
          {(leftDeg !== null || rightDeg !== null) && (
            <p className={`text-xs rounded-lg px-3 py-2 ${armResult.drift ? "bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"}`}>
              {armResult.explanation}
            </p>
          )}
          <p className="text-xs font-semibold text-slate-700">Your judgement (you can override the phone):</p>
          <YesNoRow value={arms} onChange={setArms} yesLabel="Drifts / weak" noLabel="Both steady" />
        </Step>

        <Step
          icon={Mic}
          letter="S"
          title="Speech"
          how={'Ask them to repeat: "Today is a sunny day" / "आज धूप वाला दिन है". Is speech slurred, muddled, or are they unable to speak?'}
        >
          <SpeechSample />
          <YesNoRow value={speech} onChange={setSpeech} yesLabel="Slurred / wrong" noLabel="Clear" />
        </Step>

        <section className="bg-white rounded-2xl border border-slate-100 p-4 sm:p-5">
          <label className="block text-sm font-bold text-slate-900 mb-1" htmlFor="notes">
            Notes (optional)
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="What prompted the check? e.g. found confused at 14:10, left hand weak"
            className="w-full border border-slate-200 rounded-xl p-2.5 text-sm"
          />
        </section>
      </main>

      {/* T = Time: result bar */}
      {outcome && (
        <div className="fixed bottom-0 inset-x-0 z-40">
          <div
            className={`max-w-2xl mx-auto m-3 rounded-2xl shadow-2xl border p-4 space-y-2 ${
              positive ? "bg-red-600 text-white border-red-700" : outcome.status === "negative" ? "bg-white border-emerald-200" : "bg-white border-slate-200"
            }`}
          >
            <div className="flex items-start gap-2">
              {positive ? <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" /> : outcome.status === "negative" ? <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" /> : <Clock className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />}
              <div className="min-w-0">
                <p className="font-black">{outcome.headline}</p>
                {positive && <p className="text-sm text-red-50">{outcome.signs.join(" · ")}</p>}
                {outcome.timeMessage && <p className="text-xs text-red-50 mt-1">{outcome.timeMessage}</p>}
              </div>
            </div>

            <ul className={`text-xs list-disc pl-5 space-y-0.5 ${positive ? "text-white" : "text-slate-600"}`}>
              {outcome.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>

            {saved ? (
              <p className={`text-sm font-semibold ${positive ? "text-white" : "text-emerald-700"}`}>✓ {saved}</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {positive ? (
                  <>
                    <a href="tel:108" onClick={() => setAmbulanceCalled(true)} className="inline-flex items-center gap-1.5 bg-white text-red-700 font-black px-4 py-2 rounded-xl">
                      <Phone className="w-4 h-4" /> Call 108
                    </a>
                    <button
                      type="button"
                      disabled={!resident || saving}
                      onClick={() => save(true)}
                      className="inline-flex items-center gap-1.5 bg-red-800 text-white font-bold px-4 py-2 rounded-xl disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
                      Save &amp; raise stroke alert
                    </button>
                    <label className="text-xs inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={notifyFamily} onChange={(e) => setNotifyFamily(e.target.checked)} />
                      Text the family
                    </label>
                    <label className="text-xs inline-flex items-center gap-1.5">
                      <input type="checkbox" checked={ambulanceCalled} onChange={(e) => setAmbulanceCalled(e.target.checked)} />
                      Ambulance called
                    </label>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={!resident || saving}
                    onClick={() => save(false)}
                    className="inline-flex items-center gap-1.5 bg-[#357366] text-white font-bold px-4 py-2 rounded-xl disabled:opacity-50"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save check
                  </button>
                )}
                {!resident && <span className={`text-xs ${positive ? "text-red-50" : "text-slate-500"}`}>Choose the resident to save.</span>}
              </div>
            )}
            {error && <p className="text-xs bg-white text-red-700 rounded-lg px-2 py-1">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
