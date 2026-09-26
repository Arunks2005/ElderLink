"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  Utensils,
  GlassWater,
  Smile,
  Pill,
  NotebookPen,
  Mic,
  MicOff,
  Camera,
  X,
  ChevronDown,
  Gauge,
  HeartPulse,
  Thermometer,
  CheckCircle2,
  AlertCircle,
  Activity,
  Sparkles,
  MapPin,
  Radio,
  Circle,
  Info,
  Clock,
  ShieldAlert,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/* ------------------------------------------------------------------ */
/* Schema-aligned constants                                            */
/* ------------------------------------------------------------------ */

/**
 * NOTE ON THE DB CONTRACT (public.care_logs_demo)
 *  - resident_name TEXT NOT NULL        -> always send a string
 *  - room          TEXT NOT NULL        -> always send a string
 *  - entry_source  CHECK in ('demo','manual','sensor')
 *  - pain_scale     CHECK 0..10 (or NULL)
 *  - systolic/diastolic/heart_rate INTEGER -> must be whole numbers
 *  - temperature    NUMERIC(4,1)        -> max 999.9, one decimal place
 *  - source_id      UNIQUE (partial)    -> used here as an idempotency key
 *
 * washroom_visits / activity_level / sleep_hours / sleep_quality have been
 * REMOVED from this table — those are now tracked as simulated sensor
 * fields directly on daily_aggregates, not through manual staff logging.
 */

const OPTIONS = {
  meals: {
    label: "Meals",
    hint: "Intake at the most recent meal",
    icon: Utensils,
    choices: ["Ate Fully", "Partially", "Refused"],
  },
  fluids: {
    label: "Fluids",
    hint: "Hydration since last log",
    icon: GlassWater,
    choices: ["Good", "Low", "None"],
  },
  mood: {
    label: "Mood",
    hint: "General affect and demeanour",
    icon: Smile,
    choices: ["Happy", "Calm", "Agitated", "Confused"],
  },
  medication: {
    label: "Medication",
    hint: "Scheduled dose outcome",
    icon: Pill,
    choices: ["Given", "Refused", "Missed"],
  },
} as const;

const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB

const VITAL_RANGES = {
  systolic: { min: 60, max: 300, label: "Systolic blood pressure" },
  diastolic: { min: 30, max: 200, label: "Diastolic blood pressure" },
  heartRate: { min: 20, max: 250, label: "Heart rate" },
  tempF: { min: 90, max: 110, label: "Temperature" },
} as const;

type Category = keyof typeof OPTIONS;
type LogState = Record<Category, string> & { notes: string };
type EntrySource = "manual" | "sensor";
type TempUnit = "F" | "C";

/* ------------------------------------------------------------------ */
/* Speech recognition typings                                          */
/* ------------------------------------------------------------------ */

type SpeechRecognitionResultLike = {
  resultIndex: number;
  results: {
    [i: number]: { [j: number]: { transcript: string }; isFinal: boolean };
    length: number;
  };
};

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionResultLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** INTEGER columns: reject decimals/garbage, never send a float. */
function toInt(val: string): number | null {
  const t = val.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** NUMERIC(4,1): one decimal place, max 999.9. */
function toOneDecimal(val: string): number | null {
  const t = val.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

function celsiusToF(c: number) {
  return c * 9 / 5 + 32;
}

function inRange(n: number, min: number, max: number) {
  return n >= min && n <= max;
}

function makeUuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for older browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/* Presentational sub-components                                       */
/* ------------------------------------------------------------------ */

function SectionCard({
  icon: Icon,
  title,
  hint,
  required,
  complete,
  badge,
  delay = 0,
  accent = "slate",
  children,
}: {
  icon: React.ElementType;
  title: string;
  hint?: string;
  required?: boolean;
  complete?: boolean;
  badge?: React.ReactNode;
  delay?: number;
  accent?: "slate" | "teal";
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ animationDelay: `${delay}ms` }}
      className={`bg-white rounded-2xl border p-5 shadow-sm transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 fill-mode-both ${
        complete
          ? "border-teal-200 ring-1 ring-teal-500/10"
          : "border-slate-200/80 hover:border-slate-300"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-2.5 min-w-0">
          <div
            className={`w-9 h-9 shrink-0 rounded-xl flex items-center justify-center border ${
              accent === "teal"
                ? "bg-teal-50 border-teal-100 text-teal-700"
                : "bg-slate-100 border-slate-200/70 text-slate-700"
            }`}
          >
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-slate-800 text-sm leading-tight">
              {title}
              {required ? (
                <span className="text-rose-500 ml-1">*</span>
              ) : (
                <span className="text-[11px] font-normal text-slate-400 ml-2">
                  Optional
                </span>
              )}
            </h2>
            {hint && (
              <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                {hint}
              </p>
            )}
          </div>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function SelectedBadge({ value }: { value: string }) {
  return (
    <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100 animate-in fade-in zoom-in-95 duration-200">
      <CheckCircle2 className="w-3.5 h-3.5" />
      {value}
    </span>
  );
}

function ChoiceGrid({
  choices,
  value,
  onPick,
  columns = 3,
  name,
}: {
  choices: readonly string[];
  value: string;
  onPick: (choice: string) => void;
  columns?: 3 | 4;
  name: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={`grid gap-2.5 ${
        columns === 4 ? "grid-cols-4" : "grid-cols-3"
      }`}
    >
      {choices.map((choice) => {
        const active = value === choice;
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(choice)}
            className={`py-3 px-2 rounded-xl text-xs font-bold text-center border transition-all duration-150 motion-safe:active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 ${
              active
                ? "bg-teal-700 text-white border-teal-700 shadow-sm motion-safe:scale-[1.02]"
                : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100 hover:border-slate-300"
            }`}
          >
            {choice}
          </button>
        );
      })}
    </div>
  );
}

function NumberField({
  label,
  unit,
  icon: Icon,
  value,
  onChange,
  placeholder,
  step,
  invalid,
}: {
  label: string;
  unit?: string;
  icon?: React.ElementType;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  step?: string;
  invalid?: boolean;
}) {
  return (
    <div>
      <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-slate-400" />}
        {label}
        {unit && <span className="text-slate-400 font-normal">({unit})</span>}
      </label>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        className={`w-full rounded-xl border px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-shadow focus:outline-none focus:ring-2 ${
          invalid
            ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
            : "border-slate-200 focus:border-teal-600 focus:ring-teal-500/20"
        }`}
      />
    </div>
  );
}

function ProgressRing({ value, total }: { value: number; total: number }) {
  const pct = total > 0 ? value / total : 0;
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);
  const done = value === total;

  return (
    <div className="relative w-[88px] h-[88px] shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          className="text-slate-100"
        />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-all duration-500 ease-out ${
            done ? "text-teal-600" : "text-teal-500"
          }`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-extrabold text-slate-900 leading-none">
          {Math.round(pct * 100)}%
        </span>
        <span className="text-[10px] font-semibold text-slate-400 mt-0.5">
          {value}/{total}
        </span>
      </div>
    </div>
  );
}

function ChecklistRow({ label, done }: { label: string; done: boolean }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {done ? (
        <CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0" />
      ) : (
        <Circle className="w-4 h-4 text-slate-300 shrink-0" />
      )}
      <span className={done ? "text-slate-500 line-through" : "text-slate-700 font-medium"}>
        {label}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function CareLogPage() {
  const params = useParams();
  const router = useRouter();

  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : (rawId as string) || "";

  /* -------------------- resident -------------------- */
  const [residentName, setResidentName] = useState("");
  const [residentRoom, setResidentRoom] = useState<string | null>(null);
  const [residentLoadError, setResidentLoadError] = useState(false);
  const [residentLoading, setResidentLoading] = useState(true);

  /* -------------------- required fields -------------------- */
  const [log, setLog] = useState<LogState>({
    meals: "",
    fluids: "",
    mood: "",
    medication: "",
    notes: "",
  });

  /* -------------------- meta -------------------- */
  const [entrySource, setEntrySource] = useState<EntrySource>("manual");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);

  // Stable idempotency key for the unique partial index on source_id.
  const sourceIdRef = useRef<string>(makeUuid());

  /* -------------------- today's activity -------------------- */
  const [todayCount, setTodayCount] = useState<number | null>(null);
  const [lastLoggedAt, setLastLoggedAt] = useState<string | null>(null);

  /* -------------------- dictation -------------------- */
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  /* -------------------- photo -------------------- */
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* -------------------- vitals -------------------- */
  const [showVitals, setShowVitals] = useState(false);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");
  const [tempUnit, setTempUnit] = useState<TempUnit>("F");

  /* -------------------- pain -------------------- */
  const [painScale, setPainScale] = useState(0);
  const [painNote, setPainNote] = useState("");
  const painRequired = painScale >= 6;

  /* -------------------- derived -------------------- */
  const categories = useMemo(() => Object.keys(OPTIONS) as Category[], []);
  const categoriesCompleted = categories.filter((c) => log[c]).length;
  const totalRequired = categories.length;
  const completed = categoriesCompleted;
  const allDone = completed === totalRequired;
  const painPct = (painScale / 10) * 100;

  const hasVitals = Boolean(
    systolic.trim() || diastolic.trim() || heartRate.trim() || temperature.trim(),
  );

  const clearError = useCallback(() => {
    setError((prev) => (prev ? "" : prev));
  }, []);

  const raiseError = useCallback((message: string) => {
    setError(message);
    setErrorKey((k) => k + 1);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    }
  }, []);

  /* -------------------- effects -------------------- */

  // Revoke the previous object URL whenever the preview changes/unmounts.
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

    // Resident header data (denormalised onto the log row: resident_name, room).
  useEffect(() => {
    let isMounted = true;

    async function fetchResident() {
      if (!id) {
        setResidentLoading(false);
        setResidentLoadError(true);
        setResidentName("Unknown Resident");
        return;
      }
      const supabase = createClient();

      let { data, error: err } = await supabase
        .from("residents")
        .select("full_name, room_number")
        .eq("id", id)
        .maybeSingle();

      // Defensive fallback: a clock-skew related JWT error ("issued at
      // future", "expired", etc.) can leave a stale/invalid session in
      // place. One refresh attempt clears most transient cases — if the
      // underlying device clock is actually wrong, this will still fail,
      // and that has to be fixed at the OS level, not in this component.
      const isJwtTimingError =
        err && /jwt|issued at future|expired/i.test(err.message ?? "");

      if (isJwtTimingError) {
        const { error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError) {
          const retry = await supabase
            .from("residents")
            .select("full_name, room_number")
            .eq("id", id)
            .maybeSingle();
          data = retry.data;
          err = retry.error;
        }
      }

      if (!isMounted) return;

      if (err || !data) {
        if (err) console.error("Error loading resident:", err.message);
        setResidentName("Unknown Resident");
        setResidentRoom(null);  
        setResidentLoadError(true);
      } else {
        setResidentName(data.full_name || "Unknown Resident");
        setResidentRoom(data.room_number ?? null);
        setResidentLoadError(false);
      }
      setResidentLoading(false);
    }

    fetchResident();
    return () => {
      isMounted = false;
    };
  }, [id]);
  
  // Today's entries, for the header chip ("N logs today", last logged time).
  useEffect(() => {
    let isMounted = true;

    async function loadTodayContext() {
      if (!id) return;
      const supabase = createClient();
      const since = startOfTodayISO();

      const { data, count, error: err } = await supabase
        .from("care_logs_demo")
        .select("created_at", { count: "exact" })
        .eq("resident_id", id)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1);

      if (!isMounted) return;

      if (!err) {
        setTodayCount(count ?? 0);
        setLastLoggedAt(data?.[0]?.created_at ?? null);
      }
    }

    loadTodayContext();
    return () => {
      isMounted = false;
    };
  }, [id]);

  // Dictation setup.
  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    setSpeechSupported(true);

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionResultLike) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript + " ";
      }
      if (finalText) {
        setLog((prev) => ({
          ...prev,
          notes: (prev.notes ? prev.notes.trim() + " " : "") + finalText.trim(),
        }));
      }
    };

    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        /* recognition wasn't running */
      }
      recognitionRef.current = null;
    };
  }, []);

  /* -------------------- handlers -------------------- */

  function toggleListening() {
    const recognition = recognitionRef.current;
    if (!recognition) return;

    if (listening) {
      try {
        recognition.stop();
      } catch (err) {
        console.error("Failed to stop dictation:", err);
      }
      setListening(false);
      return;
    }

    try {
      recognition.start();
      setListening(true);
    } catch (err) {
      console.error("Failed to start dictation:", err);
      setListening(false);
    }
  }

  function pick(category: Category, choice: string) {
    clearError();
    setLog((prev) => ({ ...prev, [category]: choice }));
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      raiseError("Please attach an image file (JPG, PNG, or HEIC).");
      e.target.value = "";
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      raiseError("That image is larger than 8 MB. Please retake or compress it.");
      e.target.value = "";
      return;
    }

    clearError();
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** Returns an error message, or null when the form is safe to submit. */
  function validate(): string | null {
    if (!allDone) return "Please complete all required fields before saving.";

    if (painRequired && !painNote.trim()) {
      return "Pain is rated 6 or higher. Please add a note describing the location and nature of the pain.";
    }

    const sys = toInt(systolic);
    if (systolic.trim() && sys === null) return "Systolic blood pressure must be a number.";
    if (sys !== null && !inRange(sys, VITAL_RANGES.systolic.min, VITAL_RANGES.systolic.max)) {
      return `Systolic blood pressure should be between ${VITAL_RANGES.systolic.min} and ${VITAL_RANGES.systolic.max} mmHg.`;
    }

    const dia = toInt(diastolic);
    if (diastolic.trim() && dia === null) return "Diastolic blood pressure must be a number.";
    if (dia !== null && !inRange(dia, VITAL_RANGES.diastolic.min, VITAL_RANGES.diastolic.max)) {
      return `Diastolic blood pressure should be between ${VITAL_RANGES.diastolic.min} and ${VITAL_RANGES.diastolic.max} mmHg.`;
    }
    if (sys !== null && dia !== null && dia >= sys) {
      return "Diastolic pressure must be lower than systolic pressure. Please re-check the reading.";
    }
    if ((sys === null) !== (dia === null)) {
      return "Please enter both systolic and diastolic values, or leave blood pressure blank.";
    }

    const hr = toInt(heartRate);
    if (heartRate.trim() && hr === null) return "Heart rate must be a number.";
    if (hr !== null && !inRange(hr, VITAL_RANGES.heartRate.min, VITAL_RANGES.heartRate.max)) {
      return `Heart rate should be between ${VITAL_RANGES.heartRate.min} and ${VITAL_RANGES.heartRate.max} bpm.`;
    }

    const tempF = resolveTempF();
    if (temperature.trim() && tempF === null) return "Temperature must be a number.";
    if (tempF !== null && !inRange(tempF, VITAL_RANGES.tempF.min, VITAL_RANGES.tempF.max)) {
      return `Temperature should be between ${VITAL_RANGES.tempF.min}°F and ${VITAL_RANGES.tempF.max}°F (32.2°C – 43.3°C).`;
    }

    return null;
  }

  /** Temperature is always persisted in °F to match existing rows. */
  function resolveTempF(): number | null {
    const raw = toOneDecimal(temperature);
    if (raw === null) return null;
    return tempUnit === "C" ? Math.round(celsiusToF(raw) * 10) / 10 : raw;
  }

  async function handleSave() {
    if (saving) return;

    const validationError = validate();
    if (validationError) {
      raiseError(validationError);
      return;
    }

    setSaving(true);
    setError("");

    const supabase = createClient();

    /* staff_id references staff(id); only send it when a matching staff
       row exists, otherwise the FK would reject the insert. */
    let staffId: string | null = null;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user?.id) {
      const { data: staffRow } = await supabase
        .from("staff")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      staffId = staffRow?.id ?? null;
    }

    /* ---------- photo upload ---------- */
    let photoUrl: string | null = null;
    let uploadedPath: string | null = null;

    if (photoFile) {
      const ext = (photoFile.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${id || "unassigned"}/${Date.now()}-${makeUuid()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("care-log-photos")
        .upload(path, photoFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: photoFile.type || "image/jpeg",
        });

      if (uploadError) {
        setSaving(false);
        raiseError(`Photo upload failed: ${uploadError.message}`);
        return;
      }

      uploadedPath = path;
      photoUrl = supabase.storage.from("care-log-photos").getPublicUrl(path)
        .data.publicUrl;
    }

    const payload = {
      // identity / FK columns
      resident_id: residentLoadError ? null : id || null,
      staff_id: staffId,
      source_id: sourceIdRef.current, // unique partial index -> idempotency
      // NOT NULL text columns
      resident_name: residentName.trim() || "Unknown Resident",
      room: (residentRoom ?? "").toString().trim() || "Unassigned",
      entry_source: entrySource, // 'manual' | 'sensor'
      // required care fields
      meals: log.meals,
      fluids: log.fluids,
      mood: log.mood,
      medication: log.medication,
      // optional
      notes: log.notes.trim() || null,
      photo_url: photoUrl,
      systolic: toInt(systolic),
      diastolic: toInt(diastolic),
      heart_rate: toInt(heartRate),
      temperature: resolveTempF(), // NUMERIC(4,1), stored as °F
      pain_scale: painScale > 0 ? painScale : null, // 0..10
      pain_note: painNote.trim() || null,
    };

    const { error: insertError } = await supabase
      .from("care_logs_demo")
      .insert(payload);

    if (insertError) {
      console.error("Care log insert failed:", insertError);

      // Roll the orphaned upload back so storage doesn't accumulate junk.
      if (uploadedPath) {
        await supabase.storage.from("care-log-photos").remove([uploadedPath]);
      }
      // A fresh key lets the nurse retry cleanly after a unique collision.
      sourceIdRef.current = makeUuid();

      raiseError(`Failed to save care log: ${insertError.message}`);
      setSaving(false);
      return;
    }

    setSaved(true);
    setTimeout(() => router.push("/staff/dashboard"), 1400);
  }

  const painBadgeColor = (val: number) => {
    if (val >= 7) return "bg-rose-100 text-rose-700 border-rose-200";
    if (val >= 4) return "bg-amber-100 text-amber-700 border-amber-200";
    if (val >= 1) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    return "bg-slate-100 text-slate-500 border-slate-200";
  };

  /* -------------------- success screen -------------------- */

  if (saved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center bg-white p-8 rounded-3xl border border-slate-100 shadow-xl max-w-sm w-full animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mx-auto mb-4 text-teal-600">
            <svg viewBox="0 0 52 52" className="w-9 h-9">
              <circle
                className="checkmark-circle"
                cx="26"
                cy="26"
                r="23"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              />
              <path
                className="checkmark-check"
                fill="none"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M14 27l7 7 16-16"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Care Log Saved</h2>
          <p className="text-slate-500 text-sm mt-1">
            {residentName} · Redirecting to your dashboard…
          </p>
        </div>
        <style jsx global>{`
          .checkmark-circle {
            stroke-dasharray: 145;
            stroke-dashoffset: 145;
            animation: circle-draw 0.5s ease-out forwards;
          }
          .checkmark-check {
            stroke-dasharray: 30;
            stroke-dashoffset: 30;
            animation: check-draw 0.35s ease-out 0.45s forwards;
          }
          @keyframes circle-draw {
            to {
              stroke-dashoffset: 0;
            }
          }
          @keyframes check-draw {
            to {
              stroke-dashoffset: 0;
            }
          }
        `}</style>
      </div>
    );
  }

  /* -------------------- main -------------------- */

  const initials =
    residentName
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "—";

  const summaryPanel = (
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5">
      <div className="flex items-center gap-4">
        <ProgressRing value={completed} total={totalRequired} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800">
            {allDone ? "Ready to submit" : "Entry in progress"}
          </p>
          <p className="text-xs text-slate-500 mt-1 leading-snug">
            {allDone
              ? "All required observations are recorded."
              : `${totalRequired - completed} required field${
                  totalRequired - completed === 1 ? "" : "s"
                } remaining.`}
          </p>
        </div>
      </div>

      <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-4">
        {categories.map((c) => (
          <ChecklistRow key={c} label={OPTIONS[c].label} done={Boolean(log[c])} />
        ))}
      </ul>

      <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2">
          <span className="block text-slate-400 font-semibold">Vitals</span>
          <span className="block font-bold text-slate-700 mt-0.5">
            {hasVitals ? "Recorded" : "Not added"}
          </span>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2">
          <span className="block text-slate-400 font-semibold">Pain</span>
          <span className="block font-bold text-slate-700 mt-0.5">
            {painScale === 0 ? "None" : `${painScale}/10`}
          </span>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200/70 px-3 py-2 col-span-2">
          <span className="block text-slate-400 font-semibold">Photo</span>
          <span className="block font-bold text-slate-700 mt-0.5">
            {photoFile ? "Attached" : "None"}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={!allDone || saving}
        className={`mt-5 w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-200 shadow-sm motion-safe:active:scale-[0.99] ${
          allDone && !saving
            ? "bg-teal-700 hover:bg-teal-800 text-white shadow-teal-700/10 hover:shadow-md"
            : "bg-slate-200 text-slate-400 cursor-not-allowed"
        }`}
      >
        {saving ? (
          <span className="flex items-center justify-center gap-2">
            <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Saving…
          </span>
        ) : (
          "Save Care Log"
        )}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F8FB] text-slate-900 pb-32 lg:pb-14">
      {/* ------------------------------ Header ------------------------------ */}
      <header className="bg-slate-900/95 text-white sticky top-0 z-30 border-b border-slate-800 shadow-sm backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/staff/dashboard"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors motion-safe:active:scale-90"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>

            <div className="hidden sm:flex w-11 h-11 rounded-xl bg-teal-500/15 border border-teal-400/25 items-center justify-center text-teal-300 font-bold text-sm shrink-0">
              {residentLoading ? "…" : initials}
            </div>

            <div className="min-w-0">
              <span className="text-teal-400 text-[11px] font-semibold tracking-wide uppercase flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Daily Care Log
              </span>
              <h1 className="font-bold text-white text-lg leading-tight truncate max-w-[180px] sm:max-w-sm">
                {residentLoading ? "Loading…" : residentName}
              </h1>
              <div className="flex items-center gap-3 mt-0.5">
                {residentRoom && !residentLoadError && (
                  <span className="text-slate-400 text-xs font-medium flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Room {residentRoom}
                  </span>
                )}
                {lastLoggedAt && (
                  <span className="hidden sm:flex text-slate-500 text-xs font-medium items-center gap-1">
                    <Clock className="w-3 h-3" /> Last {formatTime(lastLoggedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {todayCount !== null && (
              <span className="hidden md:inline-flex items-center gap-1.5 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/60 text-xs font-medium text-slate-300">
                {todayCount} log{todayCount === 1 ? "" : "s"} today
              </span>
            )}
            <span className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/60">
              {allDone ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-400 animate-in zoom-in duration-300" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
              )}
              <span className="text-xs font-medium text-slate-300">
                {completed}/{totalRequired}
              </span>
            </span>
          </div>
        </div>

        {/* Thin progress strip */}
        <div className="h-1 w-full bg-slate-800">
          <div
            className="h-full bg-teal-500 transition-all duration-500 ease-out"
            style={{ width: `${(completed / totalRequired) * 100}%` }}
          />
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 pt-6 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
        {/* ------------------------------ Form column ------------------------------ */}
        <main className="space-y-5 min-w-0">
          {residentLoadError && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3 text-amber-800 text-sm">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <span>
                This resident record could not be loaded. The log can still be
                saved, but it will not be linked to a resident profile. Please
                verify the resident before submitting.
              </span>
            </div>
          )}

          {/* Entry source */}
          <SectionCard
            icon={Radio}
            title="Entry Source"
            hint="Sensor integration is pending — log as staff, or record a simulated sensor reading"
            delay={0}
          >
            <div className="relative flex bg-slate-100 rounded-xl p-1">
              <div
                className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-lg bg-white shadow-sm transition-transform duration-300 ease-out"
                style={{
                  transform:
                    entrySource === "sensor"
                      ? "translateX(calc(100% + 4px))"
                      : "translateX(0)",
                }}
              />
              {(["manual", "sensor"] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setEntrySource(src)}
                  aria-pressed={entrySource === src}
                  className={`relative z-10 flex-1 py-2.5 text-xs font-bold rounded-lg transition-colors duration-200 ${
                    entrySource === src ? "text-teal-700" : "text-slate-500"
                  }`}
                >
                  {src === "manual" ? "Staff Entry" : "Simulated Sensor"}
                </button>
              ))}
            </div>
          </SectionCard>

          {/* Required observation cards */}
          {categories.map((category, i) => {
            const { label, hint, icon: Icon, choices } = OPTIONS[category];
            return (
              <SectionCard
                key={category}
                icon={Icon}
                title={label}
                hint={hint}
                required
                accent="teal"
                complete={Boolean(log[category])}
                badge={log[category] ? <SelectedBadge value={log[category]} /> : undefined}
                delay={60 + i * 50}
              >
                <ChoiceGrid
                  name={label}
                  choices={choices}
                  value={log[category]}
                  onPick={(choice) => pick(category, choice)}
                  columns={choices.length === 4 ? 4 : 3}
                />
              </SectionCard>
            );
          })}

          {/* Notes */}
          <SectionCard
            icon={NotebookPen}
            title="Notes"
            hint="Behaviour, care responses, or anything the next shift should know"
            delay={340}
            badge={
              speechSupported ? (
                <button
                  type="button"
                  onClick={toggleListening}
                  className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full border transition-all motion-safe:active:scale-95 ${
                    listening
                      ? "bg-rose-50 text-rose-600 border-rose-200 animate-pulse"
                      : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {listening ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" /> Stop
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5 text-teal-600" /> Dictate
                    </>
                  )}
                </button>
              ) : undefined
            }
          >
            <textarea
              value={log.notes}
              onChange={(e) => setLog((prev) => ({ ...prev, notes: e.target.value }))}
              placeholder="e.g. Ate most of lunch with encouragement, walked to the lounge unaided…"
              rows={4}
              maxLength={2000}
              className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-all resize-none"
            />
            <div className="flex justify-between items-center mt-2">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Info className="w-3 h-3" /> Avoid abbreviations that other
                shifts may not recognise.
              </span>
              <span className="text-[11px] text-slate-400 tabular-nums">
                {log.notes.length}/2000
              </span>
            </div>
          </SectionCard>

          {/* Photo */}
          <SectionCard
            icon={Camera}
            title="Skin & Wound Photo"
            hint="For tears, bruises, or pressure sores — max 8 MB"
            delay={390}
          >
            {photoPreview ? (
              <div className="flex items-center gap-4">
                <div className="relative w-28 h-28 rounded-xl overflow-hidden border border-slate-200 shadow-sm animate-in fade-in zoom-in-95 duration-300">
                  <Image
                    src={photoPreview}
                    alt="Wound or skin observation"
                    fill
                    unoptimized
                    className="object-cover"
                  />
                  <button
                    type="button"
                    onClick={clearPhoto}
                    className="absolute top-1.5 right-1.5 bg-slate-900/80 hover:bg-slate-900 text-white rounded-full p-1 transition-colors motion-safe:active:scale-90"
                    aria-label="Remove photo"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="text-xs text-slate-500 min-w-0">
                  <p className="font-semibold text-slate-700 truncate">
                    {photoFile?.name}
                  </p>
                  <p className="mt-0.5">
                    {photoFile ? (photoFile.size / 1024 / 1024).toFixed(2) : "0"} MB
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="mt-2 text-teal-700 font-bold hover:underline"
                  >
                    Replace photo
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50/40 py-7 transition-colors motion-safe:active:scale-[0.99]"
              >
                <Camera className="w-6 h-6 text-teal-600" />
                <span className="text-xs font-bold text-teal-700">Attach Photo</span>
                <span className="text-[11px] text-slate-400">
                  Tap to use the camera or choose a file
                </span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoSelect}
              className="hidden"
            />
          </SectionCard>

          {/* Vitals */}
          <div
            style={{ animationDelay: "440ms" }}
            className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-both"
          >
            <button
              type="button"
              onClick={() => setShowVitals((v) => !v)}
              aria-expanded={showVitals}
              className="w-full p-5 flex items-center justify-between text-left hover:bg-slate-50/60 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200/70 flex items-center justify-center text-slate-700">
                  <HeartPulse className="w-4 h-4" />
                </div>
                <div>
                  <span className="font-bold text-slate-800 text-sm block">
                    Vital Signs
                    <span className="text-[11px] font-normal text-slate-400 ml-2">
                      Optional
                    </span>
                  </span>
                  <span className="text-xs text-slate-400 block mt-0.5">
                    {hasVitals
                      ? "Readings entered for this log"
                      : "Blood pressure, heart rate, and temperature"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasVitals && (
                  <span className="text-[11px] font-bold text-teal-700 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">
                    Added
                  </span>
                )}
                <ChevronDown
                  className={`w-5 h-5 text-slate-400 transition-transform duration-300 ${
                    showVitals ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>

            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                showVitals ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <div className="p-5 pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                  <NumberField
                    label="BP Systolic"
                    unit="mmHg"
                    icon={Gauge}
                    value={systolic}
                    onChange={(v) => {
                      clearError();
                      setSystolic(v);
                    }}
                    placeholder="120"
                  />
                  <NumberField
                    label="BP Diastolic"
                    unit="mmHg"
                    icon={Gauge}
                    value={diastolic}
                    onChange={(v) => {
                      clearError();
                      setDiastolic(v);
                    }}
                    placeholder="80"
                  />
                  <NumberField
                    label="Heart Rate"
                    unit="bpm"
                    icon={Activity}
                    value={heartRate}
                    onChange={(v) => {
                      clearError();
                      setHeartRate(v);
                    }}
                    placeholder="72"
                  />
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                        <Thermometer className="w-3.5 h-3.5 text-slate-400" /> Temp
                      </label>
                      <div className="flex rounded-lg bg-slate-100 p-0.5">
                        {(["F", "C"] as const).map((u) => (
                          <button
                            key={u}
                            type="button"
                            onClick={() => setTempUnit(u)}
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${
                              tempUnit === u
                                ? "bg-white text-teal-700 shadow-sm"
                                : "text-slate-500"
                            }`}
                          >
                            °{u}
                          </button>
                        ))}
                      </div>
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => {
                        clearError();
                        setTemperature(e.target.value);
                      }}
                      placeholder={tempUnit === "F" ? "98.6" : "37.0"}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-shadow"
                    />
                    {tempUnit === "C" && temperature.trim() && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        Saved as {resolveTempF()?.toFixed(1)} °F
                      </p>
                    )}
                  </div>
                  <p className="col-span-2 text-[11px] text-slate-400 flex items-start gap-1.5">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
                    Blood pressure and heart rate are stored as whole numbers;
                    temperature is stored in °F to one decimal place.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Pain */}
          <SectionCard
            icon={Activity}
            title="Pain Level"
            hint="0 = no pain, 10 = worst imaginable"
            delay={470}
            badge={
              <span
                className={`shrink-0 text-xs font-bold px-3 py-1 rounded-full border transition-colors duration-300 ${painBadgeColor(
                  painScale,
                )}`}
              >
                {painScale === 0 ? "No Pain (0)" : `${painScale} / 10`}
              </span>
            }
          >
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={painScale}
              onChange={(e) => {
                clearError();
                setPainScale(Number(e.target.value));
              }}
              style={{
                background: `linear-gradient(to right, #0f766e ${painPct}%, #f1f5f9 ${painPct}%)`,
              }}
              className="w-full accent-teal-700 h-2 rounded-lg appearance-none cursor-pointer transition-[background] duration-150"
              aria-label="Pain level from 0 to 10"
              aria-valuetext={`${painScale} out of 10`}
            />
            <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-medium">
              <span>0 · None</span>
              <span>5 · Moderate</span>
              <span>10 · Severe</span>
            </div>

            {painScale >= 4 && !painRequired && (
              <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-px" />
                Moderate pain reported — a short description helps the nurse on
                the next shift.
              </p>
            )}

            {painRequired && (
              <div className="mt-4 pt-3 border-t border-rose-100 bg-rose-50/60 -mx-5 -mb-5 p-5 rounded-b-2xl animate-in fade-in slide-in-from-top-1 duration-300">
                <label className="text-xs font-bold text-rose-700 flex items-center gap-1 mb-1.5">
                  <AlertCircle className="w-4 h-4" /> Pain Location & Description
                  <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={painNote}
                  onChange={(e) => {
                    clearError();
                    setPainNote(e.target.value);
                  }}
                  rows={3}
                  placeholder="e.g. Lower back, sharp pain when turning; settled after repositioning."
                  className="w-full rounded-xl border border-rose-200 p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 resize-none bg-white"
                />
                <p className="text-[11px] text-rose-600/80 mt-1.5">
                  Pain of 6 or higher should also be escalated to the nurse in
                  charge as per facility policy.
                </p>
              </div>
            )}
          </SectionCard>

          {/* Error */}
          {error && (
            <div
              key={errorKey}
              role="alert"
              className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 text-rose-700 text-sm motion-safe:animate-[shake_0.4s_ease-in-out] animate-in fade-in duration-200"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Summary panel inline on small screens */}
          <div className="lg:hidden">{summaryPanel}</div>
        </main>

        {/* ------------------------------ Sticky side panel ------------------------------ */}
        <aside className="hidden lg:block sticky top-28">{summaryPanel}</aside>
      </div>

      {/* ------------------------------ Mobile save bar ------------------------------ */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          <button
            type="button"
            onClick={handleSave}
            disabled={!allDone || saving}
            className={`w-full py-3.5 rounded-xl text-sm font-bold transition-all duration-200 shadow-sm motion-safe:active:scale-[0.99] ${
              allDone && !saving
                ? "bg-teal-700 hover:bg-teal-800 text-white"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving Care Log…
              </span>
            ) : allDone ? (
              "Save Care Log"
            ) : (
              `${totalRequired - completed} required field${
                totalRequired - completed === 1 ? "" : "s"
              } left`
            )}
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes shake {
          10%,
          90% {
            transform: translateX(-1px);
          }
          20%,
          80% {
            transform: translateX(2px);
          }
          30%,
          50%,
          70% {
            transform: translateX(-4px);
          }
          40%,
          60% {
            transform: translateX(4px);
          }
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 22px;
          border-radius: 9999px;
          background: #ffffff;
          border: 3px solid #0f766e;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #ffffff;
          border: 3px solid #0f766e;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}