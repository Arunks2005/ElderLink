import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { groq, BEHAVIORAL_MODEL } from "@/lib/groq";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAYS_LOOKBACK = 14;
const MAX_LOGS_PER_RESIDENT = 20;

type ChatMessage = { role: "user" | "assistant"; content: string };

type ResidentRow = { id: string; full_name: string };

// ---- Matches your actual care_logs schema ----
type CareLogRow = {
  id: string;
  resident_id: string;
  created_at: string;
  meals: string | null;
  fluids: string | null;
  mood: string | null;
  medication: string | null;
  notes: string | null;
  systolic: number | null;
  diastolic: number | null;
  heart_rate: number | null;
  temperature: number | null;
  pain_scale: number | null;
  pain_note: string | null;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Finds a resident mentioned by name (full name or first name) in a piece of text.
function findResidentInText(text: string, residents: ResidentRow[]): ResidentRow | null {
  const lower = text.toLowerCase();

  for (const r of residents) {
    if (lower.includes(r.full_name.toLowerCase())) return r;
  }
  for (const r of residents) {
    const first = r.full_name.split(" ")[0];
    if (first.length > 2) {
      const re = new RegExp(`\\b${escapeRegex(first.toLowerCase())}\\b`);
      if (re.test(lower)) return r;
    }
  }
  return null;
}

// Walks conversation history newest-first to find which resident is currently
// "in focus", so follow-up questions ("what about her sleep?") keep context.
function resolveResidentFromHistory(
  messages: ChatMessage[],
  residents: ResidentRow[]
): ResidentRow | null {
  const userMessages = messages.filter((m) => m.role === "user").reverse();
  for (const m of userMessages) {
    const match = findResidentInText(m.content, residents);
    if (match) return match;
  }
  return null;
}

function formatLog(log: CareLogRow): string {
  const date = new Date(log.created_at).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts: string[] = [`[${date}]`];
  if (log.mood) parts.push(`Mood: ${log.mood}`);
  if (log.meals) parts.push(`Meals: ${log.meals}`);
  if (log.fluids) parts.push(`Fluids: ${log.fluids}`);
  if (log.medication) parts.push(`Medication: ${log.medication}`);
  if (log.systolic !== null && log.diastolic !== null) {
    parts.push(`BP: ${log.systolic}/${log.diastolic}`);
  }
  if (log.heart_rate !== null) parts.push(`HR: ${log.heart_rate} bpm`);
  if (log.temperature !== null) parts.push(`Temp: ${log.temperature}°`);
  if (log.pain_scale !== null) {
    parts.push(`Pain: ${log.pain_scale}/10${log.pain_note ? ` (${log.pain_note})` : ""}`);
  }
  if (log.notes) parts.push(`Notes: "${log.notes}"`);

  return parts.join(" | ");
}

async function buildResidentContext(resident: ResidentRow): Promise<string> {
  const since = new Date();
  since.setDate(since.getDate() - DAYS_LOOKBACK);

  const { data: logs, error } = await supabase
    .from("care_logs")
    .select(
      "id, resident_id, created_at, meals, fluids, mood, medication, notes, systolic, diastolic, heart_rate, temperature, pain_scale, pain_note"
    )
    .eq("resident_id", resident.id)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(MAX_LOGS_PER_RESIDENT);

  if (error) throw error;
  if (!logs || logs.length === 0) {
    return `No care log entries found for ${resident.full_name} in the last ${DAYS_LOOKBACK} days.`;
  }

  const timeline = (logs as CareLogRow[]).map(formatLog).join("\n");
  return `Care log entries for ${resident.full_name} (most recent first, last ${DAYS_LOOKBACK} days):\n${timeline}`;
}

const SYSTEM_PREAMBLE = `You are Behavioral AI, an assistant embedded in ElderLink, a care home management platform. You help facility staff and admins understand residents' recent wellbeing by reading structured daily care logs (meals, fluids, mood, medication, vitals, pain scale) and freeform staff notes.

Rules you must follow:
- You are NOT a doctor and must never diagnose a medical condition. Frame observations as patterns worth a look, not conclusions.
- Base your answer only on the log data provided to you in this message. If the data doesn't cover what's asked, say so plainly rather than guessing.
- Be conversational and concise, like a knowledgeable colleague — not a formal report. Use plain sentences, not bullet-point templates, unless the person asks for a list.
- If no resident's data was found for this question, ask the person to clarify which resident they mean.
- If a vitals reading is concerning (e.g. unusually high/low blood pressure or heart rate, high pain score, poor mood over multiple days) mention it clearly, but still recommend the person consult clinical judgement or the resident's care plan, not act on your word alone.`;

export async function POST(req: NextRequest) {
  try {
    const { messages } = (await req.json()) as { messages: ChatMessage[] };

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "No messages provided" }, { status: 400 });
    }

    const { data: residents, error: residentError } = await supabase
      .from("residents")
      .select("id, full_name");
    if (residentError) throw residentError;

    const resident = resolveResidentFromHistory(messages, (residents as ResidentRow[]) ?? []);

    let contextBlock: string;
    if (resident) {
      contextBlock = await buildResidentContext(resident);
    } else {
      contextBlock =
        "No specific resident has been identified in this conversation yet. Ask the person which resident they'd like to discuss, and mention you can only look at one resident's logs at a time right now.";
    }

    const systemMessage = {
      role: "system" as const,
      content: `${SYSTEM_PREAMBLE}\n\n${contextBlock}`,
    };

    const completion = await groq.chat.completions.create({
      model: BEHAVIORAL_MODEL,
      messages: [systemMessage, ...messages],
      temperature: 0.4,
    });

    const reply = completion.choices[0]?.message?.content ?? "I couldn't generate a response — please try again.";

    return NextResponse.json({
      reply,
      resident_name: resident?.full_name ?? null,
    });
  } catch (err) {
    console.error("Behavioral chat error:", err);
    return NextResponse.json(
      { error: "Failed to get a response from Behavioral AI" },
      { status: 500 }
    );
  }
}