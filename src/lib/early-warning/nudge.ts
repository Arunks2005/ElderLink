/**
 * Family "call request" messages.
 *
 * Privacy by design: the message contains ONLY the resident's first name and
 * the care home's name. It never mentions mood, health, food or any care
 * data. The family is invited to call, and the conversation happens person
 * to person.
 *
 * English and Hindi are hand-written templates that work offline. Other
 * Indian languages are produced by translating the English template with
 * the existing Groq integration, when it's configured (see /api/family-nudge).
 */

export const NUDGE_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी (Hindi)" },
  { code: "ta", label: "தமிழ் (Tamil)" },
  { code: "te", label: "తెలుగు (Telugu)" },
  { code: "bn", label: "বাংলা (Bengali)" },
  { code: "mr", label: "मराठी (Marathi)" },
  { code: "kn", label: "ಕನ್ನಡ (Kannada)" },
  { code: "ml", label: "മലയാളം (Malayalam)" },
  { code: "gu", label: "ગુજરાતી (Gujarati)" },
  { code: "pa", label: "ਪੰਜਾਬੀ (Punjabi)" },
] as const;

export type NudgeLanguage = (typeof NUDGE_LANGUAGES)[number]["code"];

export const TEMPLATE_LANGUAGES: NudgeLanguage[] = ["en", "hi"];

export function templateNudge(lang: NudgeLanguage, firstName: string, homeName: string): string | null {
  const name = firstName.trim() || "Your loved one";
  const home = homeName.trim() || "the care home";
  if (lang === "en") {
    return (
      `Namaste! We at ${home} think ${name} would really enjoy hearing from you. ` +
      `A short phone or video call this week would brighten their day. ` +
      `Any time after 4 pm works well. Warm regards, the care team.`
    );
  }
  if (lang === "hi") {
    return (
      `नमस्ते! ${home} की देखभाल टीम को लगता है कि ${name} जी आपसे बात करके बहुत खुश होंगे। ` +
      `इस हफ़्ते एक छोटी सी फ़ोन या वीडियो कॉल से उनका दिन अच्छा हो जाएगा। ` +
      `शाम 4 बजे के बाद का समय ठीक रहेगा। सादर, देखभाल टीम।`
    );
  }
  return null;
}

/** Click-to-send WhatsApp link. Staff review the text and press send themselves. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `91${digits}`; // Indian mobile without country code
  if (digits.length < 11) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
