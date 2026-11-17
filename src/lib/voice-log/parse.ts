/**
 * Voice care logging in Indian languages.
 *
 * A carer speaks a sentence like "Maria ji ne aadha khana khaya, paani kam
 * piya, dard 6 hai" and the care-log form is filled in for them to check.
 *
 * Two parsers produce the same ParsedCareLog shape:
 *   - the AI parser (server route) handles every language below;
 *   - keywordParse() is an offline fallback for English and Hindi/Hinglish,
 *     so the feature still works without an AI key.
 * sanitizeParsed() validates whatever comes back, so only the form's real
 * options and plausible vital-sign ranges can ever be applied.
 */

export const CARE_LOG_LANGUAGES = [
  { code: "en-IN", label: "English", name: "English" },
  { code: "hi-IN", label: "हिन्दी", name: "Hindi" },
  { code: "ta-IN", label: "தமிழ்", name: "Tamil" },
  { code: "te-IN", label: "తెలుగు", name: "Telugu" },
  { code: "kn-IN", label: "ಕನ್ನಡ", name: "Kannada" },
  { code: "ml-IN", label: "മലയാളം", name: "Malayalam" },
  { code: "mr-IN", label: "मराठी", name: "Marathi" },
  { code: "bn-IN", label: "বাংলা", name: "Bengali" },
  { code: "gu-IN", label: "ગુજરાતી", name: "Gujarati" },
  { code: "pa-IN", label: "ਪੰਜਾਬੀ", name: "Punjabi" },
] as const;

export type CareLogLanguage = (typeof CARE_LOG_LANGUAGES)[number]["code"];

export const MEAL_CHOICES = ["Ate Fully", "Partially", "Refused"] as const;
export const FLUID_CHOICES = ["Good", "Low", "None"] as const;
export const MOOD_CHOICES = ["Happy", "Calm", "Agitated", "Confused"] as const;
export const MED_CHOICES = ["Given", "Refused", "Missed"] as const;

export type ParsedCareLog = {
  meals?: (typeof MEAL_CHOICES)[number];
  fluids?: (typeof FLUID_CHOICES)[number];
  mood?: (typeof MOOD_CHOICES)[number];
  medication?: (typeof MED_CHOICES)[number];
  pain_scale?: number;
  pain_note?: string;
  systolic?: number;
  diastolic?: number;
  heart_rate?: number;
  temperature?: { value: number; unit: "F" | "C" };
  /** Short English summary/translation for the next shift. */
  notes_en?: string;
};

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function oneOf<T extends readonly string[]>(list: T, v: unknown): T[number] | undefined {
  if (typeof v !== "string") return undefined;
  const hit = list.find((c) => c.toLowerCase() === v.trim().toLowerCase());
  return hit as T[number] | undefined;
}

function intIn(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  return r >= min && r <= max ? r : undefined;
}

function text(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

/** Keep only values the care-log form can accept. */
export function sanitizeParsed(raw: unknown): ParsedCareLog {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  const out: ParsedCareLog = {};
  const meals = oneOf(MEAL_CHOICES, o.meals);
  if (meals) out.meals = meals;
  const fluids = oneOf(FLUID_CHOICES, o.fluids);
  if (fluids) out.fluids = fluids;
  const mood = oneOf(MOOD_CHOICES, o.mood);
  if (mood) out.mood = mood;
  const med = oneOf(MED_CHOICES, o.medication);
  if (med) out.medication = med;
  const pain = intIn(o.pain_scale, 0, 10);
  if (pain !== undefined) out.pain_scale = pain;
  const painNote = text(o.pain_note, 200);
  if (painNote) out.pain_note = painNote;
  const sys = intIn(o.systolic, 60, 300);
  const dia = intIn(o.diastolic, 30, 200);
  if (sys !== undefined && dia !== undefined && sys > dia) {
    out.systolic = sys;
    out.diastolic = dia;
  }
  const hr = intIn(o.heart_rate, 20, 250);
  if (hr !== undefined) out.heart_rate = hr;

  const t = o.temperature;
  let tv: number | undefined;
  let tu: "F" | "C" | undefined;
  if (t && typeof t === "object") {
    tv = Number((t as Record<string, unknown>).value);
    const u = String((t as Record<string, unknown>).unit ?? "").toUpperCase();
    tu = u === "C" ? "C" : u === "F" ? "F" : undefined;
  } else if (typeof t === "number" || typeof t === "string") {
    tv = Number(t);
  }
  if (tv !== undefined && Number.isFinite(tv)) {
    const unit = tu ?? (tv <= 45 ? "C" : "F");
    const ok = unit === "C" ? tv >= 32 && tv <= 43 : tv >= 90 && tv <= 110;
    if (ok) out.temperature = { value: Math.round(tv * 10) / 10, unit };
  }

  const notes = text(o.notes_en, 500);
  if (notes) out.notes_en = notes;
  return out;
}

/* ------------------------------------------------------------------ */
/* Offline keyword parser (English + Hindi / Hinglish)                 */
/* ------------------------------------------------------------------ */

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

export function normaliseDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

const has = (s: string, words: string[]) => words.some((w) => s.includes(w));

export function keywordParse(input: string): ParsedCareLog {
  const s = normaliseDigits(input.toLowerCase());
  const out: Record<string, unknown> = {};

  // Meals: check the most specific outcome first.
  if (has(s, ["refused food", "refused meal", "did not eat", "didn't eat", "not eating", "khana nahi", "nahi khaya", "खाना नहीं", "नहीं खाया"]))
    out.meals = "Refused";
  else if (has(s, ["half", "partially", "partly", "a little food", "aadha", "adha", "thoda khaya", "आधा", "थोड़ा खाया", "थोडा खाया"]))
    out.meals = "Partially";
  else if (has(s, ["ate fully", "ate well", "full meal", "finished", "ate everything", "pura khana", "poora khana", "achha khaya", "पूरा खाना", "पूरा खाया", "अच्छा खाया"]))
    out.meals = "Ate Fully";

  // Fluids: "kam paani piya" must win over "paani piya".
  if (has(s, ["no water", "no fluids", "didn't drink", "did not drink", "paani nahi", "pani nahi", "पानी नहीं"]))
    out.fluids = "None";
  else if (has(s, ["less water", "little water", "low fluid", "drank little", "kam paani", "kam pani", "paani kam", "pani kam", "पानी कम", "कम पानी"]))
    out.fluids = "Low";
  else if (has(s, ["drank well", "good fluids", "plenty of water", "paani piya", "pani piya", "पानी पिया"]))
    out.fluids = "Good";

  if (has(s, ["confused", "disoriented", "bhool", "bhram", "भ्रमित", "उलझन", "भूल"])) out.mood = "Confused";
  else if (has(s, ["agitated", "angry", "restless", "irritable", "gussa", "bechain", "chidchida", "गुस्सा", "बेचैन", "चिड़चिड़"]))
    out.mood = "Agitated";
  else if (has(s, ["happy", "cheerful", "smiling", "khush", "खुश"])) out.mood = "Happy";
  else if (has(s, ["calm", "settled", "relaxed", "shant", "aaram", "शांत", "आराम"])) out.mood = "Calm";

  if (has(s, ["refused medicine", "refused tablet", "refused medication", "dawa nahi", "dawai nahi", "दवा नहीं", "दवाई नहीं"]))
    out.medication = "Refused";
  else if (has(s, ["missed", "chhoot", "छूट"])) out.medication = "Missed";
  else if (has(s, ["medicine given", "tablet given", "medication given", "took medicine", "took tablet", "dawa di", "dawai di", "dawa li", "dawai li", "दवा दी", "दवाई दी", "दवा ली", "दवाई ली"]))
    out.medication = "Given";

  const pain = s.match(/(?:pain|dard|दर्द)\D{0,15}?(\d{1,2})/) ?? s.match(/(\d{1,2})\s*(?:\/|out of|में से)\s*10/);
  if (pain) out.pain_scale = Number(pain[1]);

  const bp = s.match(/(\d{2,3})\s*(?:\/|over|by|बटा)\s*(\d{2,3})/);
  if (bp) {
    out.systolic = Number(bp[1]);
    out.diastolic = Number(bp[2]);
  }

  const hr = s.match(/(?:pulse|heart rate|\bhr\b|nabz|nabj|dhadkan|नब्ज़|नब्ज|धड़कन)\D{0,10}?(\d{2,3})/);
  if (hr) out.heart_rate = Number(hr[1]);

  const temp = s.match(/(?:temp(?:erature)?|bukhar|taapman|tapman|बुखार|तापमान)\D{0,10}?(\d{2,3}(?:\.\d)?)/);
  if (temp) out.temperature = Number(temp[1]);

  return sanitizeParsed(out);
}

/* ------------------------------------------------------------------ */
/* AI prompt                                                           */
/* ------------------------------------------------------------------ */

export function careLogExtractionPrompt(languageName: string) {
  return [
    "You extract structured care-log fields from a carer's spoken note in an Indian elder-care home.",
    `The note is in ${languageName} (it may mix in English words, Hinglish or romanised text).`,
    "Return ONLY a JSON object with these keys (use null when the note does not say):",
    '  "meals": one of "Ate Fully" | "Partially" | "Refused"',
    '  "fluids": one of "Good" | "Low" | "None"',
    '  "mood": one of "Happy" | "Calm" | "Agitated" | "Confused"',
    '  "medication": one of "Given" | "Refused" | "Missed"',
    '  "pain_scale": integer 0-10',
    '  "pain_note": short English text about where/what the pain is',
    '  "systolic", "diastolic", "heart_rate": integers',
    '  "temperature": {"value": number, "unit": "F" | "C"}',
    '  "notes_en": one or two short English sentences translating anything else the next shift should know',
    "If the carer corrects themselves, use the LATEST value they said (e.g. \"BP 140 by 90, no, 130 by 80\" -> 130/80).",
    "Spoken numbers count: \"140 by 90\", \"140 over 90\", \"एक सौ चालीस बटा नब्बे\" are blood pressure.",
    "Only fill pain_scale when pain is actually mentioned (\"no pain\" = 0). If pain is not mentioned at all, pain_scale is null.",
    "Only choose a mood option when it clearly matches. Sad, low, quiet or tearful is NOT Agitated: leave mood null and describe it in notes_en.",
    '"notes_en" must hold every observation NOT already captured in the other fields (feelings, requests, behaviour); null if nothing else was said.',
    "Never guess values that are not stated. Never add medical advice. Output JSON only.",
  ].join("\n");
}
