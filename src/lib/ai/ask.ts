import Groq from "groq-sdk";
import { GoogleGenAI } from "@google/genai";

/**
 * Shared LLM helper: Groq first, Gemini as fallback. Server-only.
 * Throws when no provider is configured or every provider fails.
 */

export type ChatMessage = { role: "user" | "assistant"; content: string };

export function aiConfigured() {
  return Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

export async function askModel(
  system: string,
  messages: ChatMessage[],
  opts: {
    maxTokens?: number;
    temperature?: number;
    /** Ask for a bare JSON object (faster, no ```json fences). */
    json?: boolean;
    /**
     * Reasoning models (gpt-oss) "think" before answering. For quick
     * extraction jobs use "low": with the default the thinking can use up
     * max_tokens and the answer comes back empty (then we fall back to the
     * slower provider).
     */
    reasoning?: "low" | "medium" | "high";
  } = {}
): Promise<{ reply: string; provider: string }> {
  const maxTokens = opts.maxTokens ?? 700;
  const temperature = opts.temperature ?? 0.3;
  const errors: string[] = [];

  if (process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
      const isReasoning = /gpt-oss|qwen3|deepseek-r1/i.test(model);
      const completion = await groq.chat.completions.create({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
        ...(isReasoning && opts.reasoning ? { reasoning_effort: opts.reasoning } : {}),
        ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
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
          config: {
            systemInstruction: system,
            maxOutputTokens: maxTokens,
            temperature,
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
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

/** Pull the first JSON object out of a model reply (tolerates ```json fences). */
export function extractJson(reply: string): unknown {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
}
