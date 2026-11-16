import { createClient } from "@/lib/supabase/server";
import { CARE_HOME_TZ } from "@/lib/early-warning/server";
import { firstNameOf } from "@/lib/early-warning/engine";
import { buildFamilyContext, familySystemPrompt, type FamilyChatLog } from "@/lib/family-chat/context";
import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

// ---------------------------------------------------------------------------
// POST /api/family-chat
//
// A chatbot for family members that can ONLY talk about their own relative.
//
// Access control (enforced here on the server, not in the browser):
//   - caller must be signed in;
//   - caller's account must be linked to `residentId` via
//     family_contacts.profile_id. Any other resident → 403.
//   - all reads run as the caller (anon key + cookie), so RLS also applies.
//
// The model only sees that one resident's last 7 days of care logs (real
// staff entries; simulated entries are excluded), plus incidents and
// emergency alerts from the last 30 days.
// ---------------------------------------------------------------------------

type ChatMessage = { role: "user" | "assistant"; content: string };

// Simple per-user rate limit (per server instance): 20 questions / 10 min.
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const hits = new Map<string, number[]>();
function rateLimited(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > RATE_MAX;
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string"
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }))
    .slice(-8);
}

async function askModel(system: string, messages: ChatMessage[]): Promise<{ reply: string; provider: string }> {
  const errors: string[] = [];

  if (process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0.3,
        max_tokens: 700,
        messages: [{ role: "system", content: system }, ...messages],
      });
      const reply = completion.choices[0]?.message?.content?.trim();
      if (reply) return { reply, provider: "groq" };
      errors.push("Groq returned an empty reply");
    } catch (e) {
      errors.push(`Groq: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  if (process.env.GEMINI_API_KEY) {
    const models = (process.env.GEMINI_MODELS || process.env.GEMINI_MODEL || "gemini-3.8-flash,gemini-3.5-flash-lite")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean);
    const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    // Gemini expects user/model roles and must start with a user turn.
    const contents = messages
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }))
      .filter((_, i, arr) => !(i === 0 && arr[0].role === "model"));
    for (const model of models) {
      try {
        const res = await gemini.models.generateContent({
          model,
          contents,
          config: { systemInstruction: system, maxOutputTokens: 700 },
        });
        const reply = typeof res.text === "string" ? res.text.trim() : "";
        if (reply) return { reply, provider: "gemini" };
      } catch (e) {
        errors.push(`Gemini ${model}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }
  }

  throw new Error(errors.length ? errors.join(" | ") : "No AI provider configured (set GROQ_API_KEY or GEMINI_API_KEY).");
}

export async function POST(request: Request) {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return Response.json({ error: "Server is missing Supabase configuration." }, { status: 500 });
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return Response.json({ error: "Please sign in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { residentId?: unknown; messages?: unknown };
  const residentId = typeof body.residentId === "string" ? body.residentId : "";
  const messages = sanitizeMessages(body.messages);
  if (!residentId || messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "Ask a question about your relative." }, { status: 400 });
  }

  // ---- Server-side access check ---------------------------------------
  const { data: links, error: linkErr } = await supabase
    .from("family_contacts")
    .select("resident_id")
    .eq("profile_id", auth.user.id);
  if (linkErr) return Response.json({ error: "Could not verify your family account." }, { status: 500 });
  if (!(links ?? []).some((l) => l.resident_id === residentId)) {
    return Response.json({ error: "You can only ask about your own relative." }, { status: 403 });
  }

  if (rateLimited(auth.user.id)) {
    return Response.json({ error: "Too many questions in a short time. Please wait a few minutes." }, { status: 429 });
  }

  // ---- Load ONLY this resident's records ------------------------------
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [residentRes, logsRes, incidentsRes, emergenciesRes] = await Promise.all([
    supabase
      .from("residents")
      .select("full_name, room_number, dob, dietary_needs, medical_notes")
      .eq("id", residentId)
      .maybeSingle(),
    supabase
      .from("care_logs_demo")
      .select("created_at, meals, fluids, mood, medication, notes, pain_scale, temperature, heart_rate, systolic, diastolic, entry_source")
      .eq("resident_id", residentId)
      .gte("created_at", since7)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("incidents").select("description, created_at").eq("resident_id", residentId).gte("created_at", since30),
    supabase.from("emergency_alerts").select("*").eq("resident_id", residentId).gte("created_at", since30),
  ]);

  if (residentRes.error || !residentRes.data) {
    return Response.json({ error: "Could not load your relative's record." }, { status: 500 });
  }
  if (logsRes.error) {
    return Response.json({ error: "Could not load care logs." }, { status: 500 });
  }

  const resident = residentRes.data as {
    full_name: string;
    room_number: string | null;
    dob: string | null;
    dietary_needs: string | null;
    medical_notes: string | null;
  };

  const { context, logsUsed, simulatedExcluded } = buildFamilyContext({
    resident,
    logs: (logsRes.data ?? []) as FamilyChatLog[],
    incidents: incidentsRes.error ? [] : ((incidentsRes.data ?? []) as { description: string | null; created_at: string }[]),
    emergencies: emergenciesRes.error ? [] : ((emergenciesRes.data ?? []) as Record<string, unknown>[]),
    timeZone: CARE_HOME_TZ,
  });

  const system =
    familySystemPrompt({
      residentFirstName: firstNameOf(resident.full_name),
      homeName: process.env.CARE_HOME_NAME || "the care home",
      homePhone: process.env.CARE_HOME_PHONE || null,
    }) + `\n\n<RESIDENT RECORDS>\n${context}\n</RESIDENT RECORDS>`;

  try {
    const { reply, provider } = await askModel(system, messages);
    return Response.json({ reply, provider, logsUsed, simulatedExcluded });
  } catch (e) {
    // Provider errors stay in the server log; families get a plain message.
    console.error("family-chat provider error:", e instanceof Error ? e.message : e);
    return Response.json(
      { error: "The assistant is unavailable right now. Please try again or call the care home." },
      { status: 503 }
    );
  }
}
