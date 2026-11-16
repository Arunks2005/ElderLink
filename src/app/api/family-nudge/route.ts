import { requireCareRole } from "@/lib/auth/require-care-role";
import { NUDGE_LANGUAGES, templateNudge, type NudgeLanguage } from "@/lib/early-warning/nudge";
import Groq from "groq-sdk";

// ---------------------------------------------------------------------------
// /api/family-nudge: drafts a warm "please call" message for a family member
// in their own language.
//
// Data minimisation: the only personal data sent to the LLM is the
// resident's FIRST NAME. No health, mood or care information is ever
// included, so nothing clinical leaves ElderLink. English and Hindi use fixed
// templates and never call an LLM at all.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    firstName?: unknown;
    language?: unknown;
  };

  const firstName = String(body.firstName ?? "")
    .replace(/[^\p{L}\p{M}' .-]/gu, "")
    .trim()
    .slice(0, 40);
  const language = String(body.language ?? "en") as NudgeLanguage;
  const lang = NUDGE_LANGUAGES.find((l) => l.code === language);
  if (!lang) return Response.json({ error: "Unsupported language." }, { status: 400 });

  const homeName = process.env.CARE_HOME_NAME || "ElderLink Care Home";

  const fixed = templateNudge(language, firstName, homeName);
  if (fixed) return Response.json({ message: fixed, source: "template" });

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      {
        error: "Translation needs GROQ_API_KEY. English and Hindi work offline.",
        fallback: templateNudge("en", firstName, homeName),
      },
      { status: 503 }
    );
  }

  const english = templateNudge("en", firstName, homeName)!;
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You translate short, warm family messages for an Indian elder-care home. " +
            "Translate faithfully and respectfully into the requested language, using the natural " +
            "everyday register a family would use (respectful honorifics are good). " +
            "Do not add any information. Keep personal names unchanged. Output only the translated message.",
        },
        { role: "user", content: `Language: ${lang.label}\n\nMessage:\n${english}` },
      ],
    });
    const message = completion.choices[0]?.message?.content?.trim();
    if (!message) throw new Error("Empty translation");
    return Response.json({ message, source: "ai-translation", note: "AI translation: please read before sending." });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Translation failed.", fallback: english },
      { status: 502 }
    );
  }
}
