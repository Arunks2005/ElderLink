"use client";

import { useEffect, useRef, useState } from "react";
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
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const OPTIONS = {
  meals: {
    label: "Meals",
    icon: Utensils,
    choices: ["Ate Fully", "Partially", "Refused"],
  },
  fluids: {
    label: "Fluids",
    icon: GlassWater,
    choices: ["Good", "Low", "None"],
  },
  mood: {
    label: "Mood",
    icon: Smile,
    choices: ["Happy", "Calm", "Agitated", "Confused"],
  },
  medication: {
    label: "Medication",
    icon: Pill,
    choices: ["Given", "Refused", "Missed"],
  },
} as const;

type Category = keyof typeof OPTIONS;
type LogState = Record<Category, string> & { notes: string };

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

export default function CareLogPage() {
  const params = useParams();
  const router = useRouter();
  
  // Safely extract resident ID parameter
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : (rawId as string) || "";

  const [residentName, setResidentName] = useState("");
  const [log, setLog] = useState<LogState>({
    meals: "",
    fluids: "",
    mood: "",
    medication: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Voice dictation state
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Vitals state
  const [showVitals, setShowVitals] = useState(false);
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [heartRate, setHeartRate] = useState("");
  const [temperature, setTemperature] = useState("");

  // Pain scale state
  const [painScale, setPainScale] = useState(0);
  const [painNote, setPainNote] = useState("");
  const painRequired = painScale >= 6;

  const categories = Object.keys(OPTIONS) as Category[];
  const completed = categories.filter((c) => log[c]).length;
  const allDone = completed === categories.length;

  // Clean up Object URLs to prevent memory leaks
  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  // Client-side speech recognition support detection
  useEffect(() => {
    const SpeechCtor = getSpeechRecognitionCtor();
    if (SpeechCtor) {
      setSpeechSupported(true);
    }
  }, []);

  // Fetch resident name securely
  useEffect(() => {
    let isMounted = true;

    async function fetchResident() {
      if (!id) return;
      const supabase = createClient();
      const { data, error } = await supabase
        .from("residents")
        .select("full_name")
        .eq("id", id)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        console.error("Error loading resident:", error.message);
        setResidentName("Resident Profile");
      } else if (data?.full_name) {
        setResidentName(data.full_name);
      } else {
        setResidentName("Resident Profile");
      }
    }

    fetchResident();

    return () => {
      isMounted = false;
    };
  }, [id]);

  // Voice dictation setup
  useEffect(() => {
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) return;

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionResultLike) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + " ";
        }
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
        // Safe fallback if recognition wasn't active
      }
    };
  }, []);

  function toggleListening() {
    if (!recognitionRef.current) return;

    if (listening) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error("Failed to stop dictation:", err);
      }
      setListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setListening(true);
      } catch (err) {
        console.error("Failed to start dictation:", err);
        setListening(false);
      }
    }
  }

  function pick(category: Category, choice: string) {
    if (error) setError("");
    setLog((prev) => ({ ...prev, [category]: choice }));
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  }

  function clearPhoto() {
    setPhotoFile(null);
    setPhotoPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // Parse strings to clean numbers or null to avoid database insertion errors (NaN)
  function parseNumber(val: string): number | null {
    if (!val || val.trim() === "") return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  }

  async function handleSave() {
    if (!allDone) return;

    if (painRequired && !painNote.trim()) {
      setError(
        "Pain is rated 6 or higher. Please add a note detailing the location or nature of the pain.",
      );
      return;
    }

    setSaving(true);
    setError("");

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    let photoUrl: string | null = null;

    if (photoFile) {
      const ext = photoFile.name.split(".").pop() || "jpg";
      const path = `${id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("care-log-photos")
        .upload(path, photoFile);

      if (uploadError) {
        setSaving(false);
        setError(`Photo upload failed: ${uploadError.message}`);
        return;
      }

      const { data: publicUrlData } = supabase.storage
        .from("care-log-photos")
        .getPublicUrl(path);

      photoUrl = publicUrlData.publicUrl;
    }

    const { error: insertError } = await supabase.from("care_logs").insert({
      resident_id: id,
      staff_id: user?.id ?? null,
      meals: log.meals,
      fluids: log.fluids,
      mood: log.mood,
      medication: log.medication,
      notes: log.notes.trim() || null,
      photo_url: photoUrl,
      systolic: parseNumber(systolic),
      diastolic: parseNumber(diastolic),
      heart_rate: parseNumber(heartRate),
      temperature: parseNumber(temperature),
      pain_scale: painScale > 0 ? painScale : null,
      pain_note: painNote.trim() || null,
    });

    if (insertError) {
      console.error("Care log insert failed:", insertError);
      setError(`Failed to save care log: ${insertError.message}`);
      setSaving(false);
      return;
    }

    setSaved(true);
    setTimeout(() => router.push("/staff/dashboard"), 1400);
  }

  const getPainBadgeColor = (val: number) => {
    if (val >= 7) return "bg-rose-100 text-rose-700 border-rose-200";
    if (val >= 4) return "bg-amber-100 text-amber-700 border-amber-200";
    if (val >= 1) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    return "bg-slate-100 text-slate-500 border-slate-200";
  };

  if (saved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="text-center bg-white p-8 rounded-3xl border border-slate-100 shadow-xl max-w-sm w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="w-16 h-16 rounded-2xl bg-teal-50 border border-teal-100 flex items-center justify-center mx-auto mb-4 text-teal-600">
            <CheckCircle2 className="w-9 h-9" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">Care Log Saved</h2>
          <p className="text-slate-500 text-sm mt-1">
            Redirecting to your dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-12">
      {/* Top Header */}
      <header className="bg-slate-900 text-white sticky top-0 z-30 border-b border-slate-800 shadow-sm backdrop-blur-md bg-slate-900/95">
        <div className="max-w-2xl mx-auto px-4 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <Link
              href="/staff/dashboard"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <span className="text-teal-400 text-xs font-semibold tracking-wide uppercase flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> Daily Care Log
              </span>
              <h1 className="font-bold text-white text-lg leading-tight truncate max-w-[200px] sm:max-w-xs">
                {residentName || "Loading..."}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-full border border-slate-700/60">
            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
            <span className="text-xs font-medium text-slate-300">
              {completed}/{categories.length} Completed
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-5">
        {/* Progress indicator card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm">
          <div className="flex justify-between items-center text-xs font-semibold text-slate-600 mb-2">
            <span>Required Entry Completion</span>
            <span className="text-teal-600 font-bold">
              {Math.round((completed / categories.length) * 100)}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-teal-600 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${(completed / categories.length) * 100}%` }}
            />
          </div>
        </div>

        {/* Category Cards */}
        {categories.map((category) => {
          const { label, icon: Icon, choices } = OPTIONS[category];
          const isSelected = Boolean(log[category]);

          return (
            <div
              key={category}
              className={`bg-white rounded-2xl border transition-all duration-200 p-5 shadow-sm ${
                isSelected
                  ? "border-teal-200/80 ring-1 ring-teal-500/10"
                  : "border-slate-200/80 hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-700">
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="font-bold text-slate-800 text-sm">
                    {label}
                    <span className="text-rose-500 ml-1 font-bold">*</span>
                  </span>
                </div>
                {log[category] && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-100">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {log[category]}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {choices.map((choice) => {
                  const active = log[category] === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => pick(category, choice)}
                      className={`py-3 px-2 rounded-xl text-xs font-bold transition-all text-center border ${
                        active
                          ? "bg-teal-700 text-white border-teal-700 shadow-sm"
                          : "bg-slate-50 text-slate-700 border-slate-200/80 hover:bg-slate-100 hover:border-slate-300"
                      }`}
                    >
                      {choice}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Notes & Dictation */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <NotebookPen className="w-4 h-4" />
              </div>
              <span className="font-bold text-slate-800 text-sm">
                Notes
                <span className="text-xs font-normal text-slate-400 ml-2">
                  (Optional)
                </span>
              </span>
            </div>
            {speechSupported && (
              <button
                type="button"
                onClick={toggleListening}
                className={`flex items-center gap-1.5 text-xs font-bold px-3.5 py-1.5 rounded-full transition-all border ${
                  listening
                    ? "bg-rose-50 text-rose-600 border-rose-200 animate-pulse"
                    : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {listening ? (
                  <>
                    <MicOff className="w-3.5 h-3.5 text-rose-600" /> Stop
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5 text-teal-600" /> Dictate
                  </>
                )}
              </button>
            )}
          </div>
          <textarea
            value={log.notes}
            onChange={(e) =>
              setLog((prev) => ({ ...prev, notes: e.target.value }))
            }
            placeholder="Add observations on behavior, care responses, or special details..."
            rows={3}
            className="w-full border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600 transition-all resize-none"
          />
        </div>

        {/* Skin & Wound Photo */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <Camera className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-slate-800 text-sm block">
                  Skin & Wound Photo
                </span>
                <span className="text-xs text-slate-400 block">
                  Optional — for tears, bruises, or sores
                </span>
              </div>
            </div>
          </div>

          {photoPreview ? (
            <div className="relative mt-3 w-32 h-32 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
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
                className="absolute top-1.5 right-1.5 bg-slate-900/80 hover:bg-slate-900 text-white rounded-full p-1 transition-colors"
                aria-label="Remove photo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200/60 px-4 py-2.5 rounded-xl transition-all"
            >
              <Camera className="w-4 h-4" /> Attach Photo
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
        </div>

        {/* Collapsible Vitals */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => setShowVitals((v) => !v)}
            className="w-full p-5 flex items-center justify-between text-left hover:bg-slate-50/50 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <HeartPulse className="w-4 h-4" />
              </div>
              <div>
                <span className="font-bold text-slate-800 text-sm block">
                  Vital Signs
                </span>
                <span className="text-xs text-slate-400 block">
                  Optional blood pressure, heart rate, and temp
                </span>
              </div>
            </div>
            <ChevronDown
              className={`w-5 h-5 text-slate-400 transition-transform duration-200 ${
                showVitals ? "rotate-180" : ""
              }`}
            />
          </button>

          {showVitals && (
            <div className="p-5 pt-0 border-t border-slate-100 grid grid-cols-2 gap-4 mt-2">
              <div>
                <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1.5">
                  <Gauge className="w-3.5 h-3.5 text-slate-400" /> BP Systolic
                  <span className="text-slate-400 font-normal">(mmHg)</span>
                </label>
                <input
                  type="number"
                  value={systolic}
                  onChange={(e) => setSystolic(e.target.value)}
                  placeholder="120"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1.5">
                  <Gauge className="w-3.5 h-3.5 text-slate-400" /> BP Diastolic
                  <span className="text-slate-400 font-normal">(mmHg)</span>
                </label>
                <input
                  type="number"
                  value={diastolic}
                  onChange={(e) => setDiastolic(e.target.value)}
                  placeholder="80"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1.5">
                  <Activity className="w-3.5 h-3.5 text-slate-400" /> Heart Rate
                  <span className="text-slate-400 font-normal">(bpm)</span>
                </label>
                <input
                  type="number"
                  value={heartRate}
                  onChange={(e) => setHeartRate(e.target.value)}
                  placeholder="72"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5 mb-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-slate-400" /> Temp
                  <span className="text-slate-400 font-normal">(°F)</span>
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(e.target.value)}
                  placeholder="98.6"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-600"
                />
              </div>
            </div>
          )}
        </div>

        {/* Pain Scale Rating */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-5 hover:border-slate-300 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                <Activity className="w-4 h-4" />
              </div>
              <span className="font-bold text-slate-800 text-sm">
                Pain Level
                <span className="text-xs font-normal text-slate-400 ml-2">
                  (0 - 10)
                </span>
              </span>
            </div>
            <span
              className={`text-sm font-bold px-3 py-1 rounded-full border ${getPainBadgeColor(
                painScale,
              )}`}
            >
              {painScale === 0 ? "No Pain (0)" : `Pain Level: ${painScale}`}
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={painScale}
            onChange={(e) => {
              if (error) setError("");
              setPainScale(Number(e.target.value));
            }}
            className="w-full accent-teal-700 h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
            aria-label="Pain level from 0 to 10"
          />
          <div className="flex justify-between text-[10px] text-slate-400 mt-2 font-medium">
            <span>0 - None</span>
            <span>5 - Moderate</span>
            <span>10 - Severe</span>
          </div>

          {painRequired && (
            <div className="mt-4 pt-3 border-t border-rose-100 bg-rose-50/50 -mx-5 -mb-5 p-5 rounded-b-2xl">
              <label className="text-xs font-bold text-rose-700 flex items-center gap-1 mb-1">
                <AlertCircle className="w-4 h-4" /> Pain Location & Description
                <span className="text-rose-500">*</span>
              </label>
              <textarea
                value={painNote}
                onChange={(e) => {
                  if (error) setError("");
                  setPainNote(e.target.value);
                }}
                rows={2}
                placeholder="e.g., Lower back, sharp pain upon turning..."
                className="w-full rounded-xl border border-rose-200 p-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 resize-none bg-white"
              />
            </div>
          )}
        </div>

        {/* Error Notification */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 text-rose-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Save Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={!allDone || saving}
            className={`w-full py-4 rounded-2xl text-sm font-bold transition-all shadow-sm ${
              allDone && !saving
                ? "bg-teal-700 hover:bg-teal-800 text-white shadow-teal-700/10 hover:shadow-md"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {saving ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving Care Log...
              </span>
            ) : (
              "Save Care Log"
            )}
          </button>

          {!allDone && (
            <p className="text-center text-slate-400 text-xs mt-3">
              Please complete all required fields (*) above to submit.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}