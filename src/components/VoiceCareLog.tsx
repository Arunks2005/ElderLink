"use client";

/**
 * Hands-free care log in any supported Indian language.
 *
 * Tap "Start speaking" once and talk naturally. After every pause the whole
 * note so far is read and the form below fills itself in live: meals,
 * fluids, mood, medication, BP, pulse, temperature, pain and notes. It keeps
 * listening (restarting when the browser stops it) until "Stop". Later
 * corrections win ("BP 140 by 90… no, 130 by 80"). Typing works too.
 * Nothing is saved until the carer checks the form and presses Save.
 */

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Languages, Loader2, Mic, Square } from "lucide-react";
import { CARE_LOG_LANGUAGES, type CareLogLanguage, type ParsedCareLog } from "@/lib/voice-log/parse";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean }; length: number } }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG_KEY = "elderlink_voice_log_lang";
const PAUSE_MS = 1200; // read the note this long after the carer pauses

const FIELD_LABELS: Record<string, string> = {
  meals: "Meals",
  fluids: "Fluids",
  mood: "Mood",
  medication: "Medication",
  pain_scale: "Pain",
  systolic: "BP",
  heart_rate: "Pulse",
  temperature: "Temp",
};

export type VoiceApply = (
  fields: ParsedCareLog,
  transcript: string,
  language: { code: string; name: string },
  sessionId: number
) => void;

export default function VoiceCareLog({ onApply }: { onApply: VoiceApply }) {
  const [lang, setLang] = useState<CareLogLanguage>("hi-IN");
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const wantListening = useRef(false);
  const session = useRef(0);
  const transcriptRef = useRef("");
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const pending = useRef(false);
  const lastParsed = useRef("");
  const langRef = useRef<CareLogLanguage>(lang);
  const onApplyRef = useRef(onApply);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    onApplyRef.current = onApply;
  }, [onApply]);

  // Browser capability + remembered language (both only knowable on the client).
  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      setSupported(Boolean(getCtor()));
      try {
        const saved = localStorage.getItem(LANG_KEY) as CareLogLanguage | null;
        if (saved && CARE_LOG_LANGUAGES.some((l) => l.code === saved)) setLang(saved);
      } catch {
        /* storage unavailable */
      }
    })();
    return () => {
      wantListening.current = false;
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      try {
        recRef.current?.stop();
      } catch {
        /* not running */
      }
    };
  }, []);

  /** Read the whole note so far and fill the form. One request at a time. */
  async function parseNow(): Promise<void> {
    const text = transcriptRef.current.trim();
    if (text.length < 2 || text === lastParsed.current) return;
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const code = langRef.current;
      const res = await fetch("/api/parse-care-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not read the note.");
      lastParsed.current = text;
      const fields = json.fields as ParsedCareLog;
      const info = CARE_LOG_LANGUAGES.find((l) => l.code === code)!;
      onApplyRef.current(fields, text, { code: info.code, name: info.name }, session.current);
      setFilled(
        Object.keys(fields)
          .filter((k) => FIELD_LABELS[k])
          .map((k) => {
            if (k === "temperature" && fields.temperature) return `Temp ${fields.temperature.value}°${fields.temperature.unit}`;
            if (k === "systolic") return `BP ${fields.systolic}/${fields.diastolic}`;
            if (k === "pain_scale") return `Pain ${fields.pain_scale}/10`;
            return `${FIELD_LABELS[k]}: ${String((fields as Record<string, unknown>)[k])}`;
          })
      );
      setNote(json.note ?? null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not read the note.");
    } finally {
      inFlight.current = false;
      setBusy(false);
      if (pending.current) {
        pending.current = false;
        void parseNow();
      }
    }
  }

  function scheduleParse() {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => void parseNow(), PAUSE_MS);
  }

  function setText(t: string) {
    transcriptRef.current = t;
    setTranscript(t);
  }

  const chooseLang = (code: CareLogLanguage) => {
    setLang(code);
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      /* storage unavailable */
    }
  };

  function startRecognition() {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langRef.current;
    rec.onresult = (e) => {
      let finalText = "";
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " ";
        else live += e.results[i][0].transcript + " ";
      }
      setInterim(live.trim());
      if (finalText.trim()) {
        const prev = transcriptRef.current.trim();
        setText((prev ? `${prev} ` : "") + finalText.trim());
        scheduleParse();
      }
    };
    rec.onerror = (e) => {
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        wantListening.current = false;
        setListening(false);
        setNote("Microphone permission was refused. Allow the microphone for this site, or type instead.");
      }
    };
    rec.onend = () => {
      setInterim("");
      // Browsers stop after a silence; keep going until the carer taps Stop.
      if (wantListening.current) {
        setTimeout(() => {
          if (!wantListening.current) return;
          try {
            startRecognition();
          } catch {
            /* will retry on next end */
          }
        }, 250);
      } else {
        setListening(false);
      }
    };
    recRef.current = rec;
    rec.start();
  }

  const start = () => {
    session.current += 1;
    lastParsed.current = "";
    setText("");
    setFilled([]);
    setNote(null);
    wantListening.current = true;
    try {
      startRecognition();
      setListening(true);
    } catch {
      wantListening.current = false;
      setListening(false);
    }
  };

  const stop = () => {
    wantListening.current = false;
    setListening(false);
    try {
      recRef.current?.stop();
    } catch {
      /* not running */
    }
    // Keep words still being recognised, then read everything once more.
    if (interim.trim()) {
      const prev = transcriptRef.current.trim();
      setText((prev ? `${prev} ` : "") + interim.trim());
      setInterim("");
    }
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    void parseNow();
  };

  return (
    <div className="rounded-3xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="p-2 rounded-xl bg-teal-600 text-white">
          <Languages className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-sm text-slate-900">Speak the whole care log in your language</p>
          <p className="text-[11px] text-slate-500">
            Meals, water, mood, medicines, BP, pulse, temperature, pain and notes: the form fills itself as you talk.
          </p>
        </div>
        <select
          value={lang}
          onChange={(e) => chooseLang(e.target.value as CareLogLanguage)}
          disabled={listening}
          className="text-sm border border-teal-200 rounded-xl px-2.5 py-2 bg-white disabled:opacity-60"
          aria-label="Language"
        >
          {CARE_LOG_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      {supported ? (
        listening ? (
          <button
            type="button"
            onClick={stop}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 text-white font-bold py-3.5"
          >
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-60" />
              <Square className="relative w-3 h-3 fill-white" />
            </span>
            Listening… tap to stop
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-teal-700 hover:bg-teal-800 text-white font-bold py-3.5"
          >
            <Mic className="w-5 h-5" /> Start speaking
          </button>
        )
      ) : (
        <p className="text-[11px] text-slate-500">Voice needs Chrome or Edge. You can type the note below instead.</p>
      )}

      <textarea
        value={transcript}
        onChange={(e) => {
          setText(e.target.value);
          scheduleParse();
        }}
        rows={3}
        maxLength={2000}
        placeholder={
          lang === "hi-IN"
            ? "जैसे: आधा खाना खाया, पानी कम पिया, थोड़ा उलझन में थे, दवा दी, बीपी 140 बटा 90, घुटने में दर्द 6"
            : lang === "en-IN"
              ? "e.g. Ate half her lunch, drank little water, seemed confused, medicine given, BP 140 over 90, knee pain 6"
              : "Tap Start speaking and talk, or type here…"
        }
        className="w-full text-sm border border-teal-200 rounded-xl p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        aria-label="Spoken care note"
      />
      {listening && (
        <p className="text-xs text-slate-500 min-h-[1rem]" aria-live="polite">
          {interim ? <span className="italic">{interim}…</span> : "Speak naturally. Pause a moment and the form fills in."}
        </p>
      )}

      {(busy || filled.length > 0) && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-teal-900" aria-live="polite">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-teal-600" />}
          {busy && filled.length === 0 ? "Filling the form…" : <strong>Filled:</strong>}
          {filled.map((f) => (
            <span key={f} className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold">
              {f}
            </span>
          ))}
          {filled.length > 0 && <span className="text-slate-500">· your words are in Notes · check before saving</span>}
        </p>
      )}
      {note && <p className="text-[11px] text-amber-800">{note}</p>}
    </div>
  );
}
