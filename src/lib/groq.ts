import Groq from "groq-sdk";

// Created on first use, not when the module loads: a missing GROQ_API_KEY
// must never break the build (Next.js loads route modules while building).
let client: Groq | null = null;

export function getGroq(): Groq {
  client ??= new Groq({ apiKey: process.env.GROQ_API_KEY });
  return client;
}

// Model choice: llama-3.3-70b-versatile was deprecated by Groq on June 17, 2026.
// openai/gpt-oss-120b is the recommended replacement for quality; swap to
// openai/gpt-oss-20b if you want lower latency / cheaper cost instead.
export const BEHAVIORAL_MODEL = "openai/gpt-oss-120b";
