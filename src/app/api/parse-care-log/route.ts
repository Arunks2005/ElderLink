import { requireCareRole } from "@/lib/auth/require-care-role";
import { aiConfigured, askModel, extractJson } from "@/lib/ai/ask";
import {
  CARE_LOG_LANGUAGES,
  careLogExtractionPrompt,
  keywordParse,
  sanitizeParsed,
  type ParsedCareLog,
} from "@/lib/voice-log/parse";

// ---------------------------------------------------------------------------
// POST /api/parse-care-log  { text, language }
//
// Turns a carer's spoken note (any supported Indian language) into care-log
// form fields. Nothing is saved here: the page fills the form and the carer
// checks it before pressing Save.
//
// Care staff only. The transcript is sent to the configured AI provider, the
// same provider ElderAI already uses. Without an AI key, an offline keyword
// parser handles English and Hindi/Hinglish.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { text?: unknown; language?: unknown };
  const transcript = String(body.text ?? "").trim().slice(0, 2000);
  const lang = CARE_LOG_LANGUAGES.find((l) => l.code === body.language) ?? CARE_LOG_LANGUAGES[0];
  if (transcript.length < 2) return Response.json({ error: "Say or type a short care note first." }, { status: 400 });

  const offline = keywordParse(transcript);

  if (aiConfigured()) {
    try {
      const { reply } = await askModel(careLogExtractionPrompt(lang.name), [{ role: "user", content: transcript }], {
        maxTokens: 400,
        temperature: 0,
      });
      const ai = sanitizeParsed(extractJson(reply));
      // AI wins; the keyword parser only fills gaps (e.g. numbers it missed).
      const fields: ParsedCareLog = { ...offline, ...ai };
      return Response.json({ fields, source: "ai", language: lang.code });
    } catch (e) {
      console.error("parse-care-log AI error:", e instanceof Error ? e.message : e);
    }
  }

  const supportedOffline = lang.code === "en-IN" || lang.code === "hi-IN";
  return Response.json({
    fields: offline,
    source: "keywords",
    language: lang.code,
    note: supportedOffline
      ? "Filled with the offline parser (no AI). Please check every field."
      : `AI is unavailable, so ${lang.name} could not be understood. Only numbers were read; please fill the rest by hand.`,
  });
}
