"use client";

/**
 * "Speak the care log" panel. The carer picks a language, speaks (or types)
 * a note, and the care-log form below is filled in for them to check.
 * Nothing is saved until they press the normal Save button.
 */

import { useEffect, useRef, useState } from "react";
import { Languages, Loader2, Mic, MicOff, Sparkles } from "lucide-react";
import { CARE_LOG_LANGUAGES, type CareLogLanguage, type ParsedCareLog } from "@/lib/voice-log/parse";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: { [i: number]: { [j: number]: { transcript: string }; isFinal: boolean }; length: number } }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANG_KEY = "elderlink_voice_log_lang";

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

export default function VoiceCareLog({
  onApply,
}: {
  onApply: (fields: ParsedCareLog, transcript: string, language: { code: string; name: string }) => void;
}) {
  const [lang, setLang] = useState<CareLogLanguage>("hi-IN");
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [filled, setFilled] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);

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
      try {
        recRef.current?.stop();
      } catch {
        /* not running */
      }
    };
  }, []);

  const chooseLang = (code: CareLogLanguage) => {
    setLang(code);
    try {
      localStorage.setItem(LANG_KEY, code);
    } catch {
      /* storage unavailable */
    }
  };

  const toggleMic = () => {
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* not running */
      }
      setListening(false);
      return;
    }
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    // Show words as they are heard; regional-language final results can lag.
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let text = "";
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) text += e.results[i][0].transcript + " ";
        else live += e.results[i][0].transcript + " ";
      }
      setInterim(live.trim());
      if (text.trim()) setTranscript((prev) => (prev ? `${prev.trim()} ` : "") + text.trim());
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.onerror = () => {
      setListening(false);
      setInterim("");
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      setFilled(null);
      setNote(null);
    } catch {
      setListening(false);
    }
  };

  const fillForm = async () => {
    // Include words still being recognised, so "Fill form" never drops them.
    const text = `${transcript} ${interim}`.trim();
    if (!text) return;
    try {
      recRef.current?.stop();
    } catch {
      /* not running */
    }
    setListening(false);
    setInterim("");
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/parse-care-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not read the note.");
      const fields = json.fields as ParsedCareLog;
      const info = CARE_LOG_LANGUAGES.find((l) => l.code === lang)!;
      onApply(fields, text, { code: info.code, name: info.name });
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
      setTranscript("");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not read the note.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white p-4 sm:p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="p-1.5 rounded-lg bg-teal-100 text-teal-700">
          <Languages className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-sm text-slate-900">Speak the care log in your language</p>
          <p className="text-[11px] text-slate-500">The form below fills itself. Check it, then save as usual.</p>
        </div>
        <select
          value={lang}
          onChange={(e) => chooseLang(e.target.value as CareLogLanguage)}
          className="ml-auto text-xs border border-teal-200 rounded-lg px-2 py-1.5 bg-white"
          aria-label="Language"
        >
          {CARE_LOG_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label} ({l.name})
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder={
          lang === "hi-IN"
            ? "जैसे: आधा खाना खाया, पानी कम पिया, थोड़ा उलझन में थे, दवा दी, घुटने में दर्द 6"
            : lang === "en-IN"
            ? "e.g. Ate half her lunch, drank little water, seemed confused, medicine given, knee pain 6"
            : "Tap the mic and speak, or type here…"
        }
        className="w-full text-sm border border-teal-200 rounded-xl p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        aria-label="Spoken care note"
      />
      {listening && (
        <p className="text-xs text-slate-500 min-h-[1rem]" aria-live="polite">
          {interim ? <span className="italic">{interim}…</span> : "Listening… speak naturally, then tap Fill the form."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {supported && (
          <button
            type="button"
            onClick={toggleMic}
            className={`inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl border ${
              listening ? "bg-rose-50 text-rose-600 border-rose-200 animate-pulse" : "bg-white text-slate-700 border-slate-200"
            }`}
          >
            {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-teal-600" />}
            {listening ? "Stop" : "Speak"}
          </button>
        )}
        <button
          type="button"
          onClick={fillForm}
          disabled={busy || !(transcript.trim() || interim.trim())}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-xl bg-teal-700 text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Fill the form
        </button>
        {!supported && <span className="text-[11px] text-slate-500">Voice input needs Chrome or Edge; typing works everywhere.</span>}
      </div>

      {filled && (
        <p className="text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
          {filled.length ? (
            <>
              <strong>Filled:</strong> {filled.join(" · ")}. Your words were added to Notes. Please check before saving.
            </>
          ) : (
            "Nothing could be filled automatically. Your words were added to Notes."
          )}
        </p>
      )}
      {note && <p className="text-[11px] text-amber-800">{note}</p>}
    </div>
  );
}
