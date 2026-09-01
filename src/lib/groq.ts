import Groq from "groq-sdk";

// Reads GROQ_API_KEY from process.env automatically.
// Make sure GROQ_API_KEY is set in .env.local (see .env.local.example)
export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// Model choice: llama-3.3-70b-versatile was deprecated by Groq on June 17, 2026.
// openai/gpt-oss-120b is the recommended replacement for quality; swap to
// openai/gpt-oss-20b if you want lower latency / cheaper cost instead.
export const BEHAVIORAL_MODEL = "openai/gpt-oss-120b";