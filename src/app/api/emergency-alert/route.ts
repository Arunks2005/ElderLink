import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import { requireCareRole } from "@/lib/auth/require-care-role";

// ---------------------------------------------------------------------------
// POST /api/emergency-alert  { residentId, alertType, channels?: ["sms","whatsapp","voice"] }
//
// 1. Records the emergency in `emergency_alerts` FIRST, so it is never lost
//    even if every message fails (it shows on the dashboard and handover).
// 2. Notifies the resident's primary family contact on each chosen channel
//    via Twilio, and reports per channel what worked and why anything failed.
//
// Signed-in care staff only. Reads run as that user (row-level security);
// no service-role key is needed.
// ---------------------------------------------------------------------------

type Channel = "sms" | "whatsapp" | "voice";
const ALL_CHANNELS: Channel[] = ["sms", "whatsapp", "voice"];

const env = (k: string) => (process.env[k] ?? "").trim();

/** Twilio needs E.164 numbers; Indian 10-digit mobiles get +91. */
function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.replace(/[\s\-()]/g, "");
  if (/^\+\d{8,15}$/.test(s)) return s;
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return null;
}

/** Turn Twilio errors into something a carer can act on. */
function explainTwilioError(e: unknown): string {
  const err = e as { code?: number; message?: string };
  switch (err?.code) {
    case 21608:
    case 21219:
      return "Twilio trial account: this family number must first be verified in the Twilio console.";
    case 21211:
      return "The family phone number is not valid.";
    case 21408:
      return "Twilio is not allowed to message this country. Enable it under Messaging → Geo permissions.";
    case 21606:
    case 21659:
      return "TWILIO_PHONE_NUMBER cannot send this type of message.";
    case 63007:
    case 63015:
    case 63016:
      return "WhatsApp: the family member must first join the Twilio WhatsApp sandbox.";
    case 20003:
      return "Twilio rejected the Account SID / Auth Token.";
    default:
      return err?.message ? `Twilio: ${err.message}` : "Sending failed.";
  }
}

function escapeXml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function POST(req: NextRequest) {
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      residentId?: unknown;
      alertType?: unknown;
      channels?: unknown;
    };
    const residentId = typeof body.residentId === "string" ? body.residentId : "";
    const alertType = String(body.alertType ?? "").trim().slice(0, 60);
    const requested = (Array.isArray(body.channels) ? body.channels : ["sms"]).filter((c): c is Channel =>
      ALL_CHANNELS.includes(c as Channel)
    );
    const channels: Channel[] = requested.length ? Array.from(new Set(requested)) : ["sms"];

    if (!residentId || !alertType) {
      return NextResponse.json({ error: "Missing resident or alert type." }, { status: 400 });
    }

    const { data: resident, error: resErr } = await supabase
      .from("residents")
      .select("full_name")
      .eq("id", residentId)
      .maybeSingle();
    if (resErr) return NextResponse.json({ error: `Could not load resident: ${resErr.message}` }, { status: 500 });
    if (!resident) return NextResponse.json({ error: "Resident not found." }, { status: 404 });

    // ---- 1. Record the emergency first ----------------------------------
    const { error: logError } = await supabase.from("emergency_alerts").insert({
      resident_id: residentId,
      type: alertType,
      status: "open",
      raised_by: auth.role === "staff" ? auth.userId : null,
    });
    const recorded = !logError;
    if (logError) console.error("Could not record emergency alert:", logError.message);

    // ---- 2. Notify the family -------------------------------------------
    const { data: contacts } = await supabase
      .from("family_contacts")
      .select("full_name, phone, is_primary")
      .eq("resident_id", residentId)
      .order("is_primary", { ascending: false });
    const primary = (contacts ?? []).find((c) => c.phone) ?? null;
    const to = toE164(primary?.phone);

    const sentChannels: Channel[] = [];
    const failures: { channel: Channel; reason: string }[] = [];
    const failAll = (reason: string) => channels.forEach((channel) => failures.push({ channel, reason }));

    const sid = env("TWILIO_ACCOUNT_SID");
    const token = env("TWILIO_AUTH_TOKEN");
    const fromNumber = env("TWILIO_PHONE_NUMBER");
    const fromWhatsApp = env("TWILIO_WHATSAPP_NUMBER");

    if (!primary) {
      failAll("No family contact with a phone number is registered for this resident.");
    } else if (!to) {
      failAll(`The family phone number "${primary.phone}" is not in a valid format.`);
    } else if (!sid || !token) {
      failAll("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
    } else {
      const client = twilio(sid, token);
      const time = new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: env("CARE_HOME_TIMEZONE") || "Asia/Kolkata",
      });
      const homePhone = env("CARE_HOME_PHONE");
      const message =
        `ElderLink Alert: Hi ${primary.full_name}, ${resident.full_name} has had a ${alertType} at ${time}. ` +
        `Our care team is with them.${homePhone ? ` Please call ${homePhone}.` : ""} - ${env("CARE_HOME_NAME") || "Care home"}`;

      for (const channel of channels) {
        try {
          if (channel === "sms") {
            if (!fromNumber) throw new Error("TWILIO_PHONE_NUMBER is not configured.");
            await client.messages.create({ body: message, from: fromNumber, to });
          } else if (channel === "whatsapp") {
            if (!fromWhatsApp) throw new Error("TWILIO_WHATSAPP_NUMBER is not configured.");
            const from = fromWhatsApp.startsWith("whatsapp:") ? fromWhatsApp : `whatsapp:${fromWhatsApp}`;
            await client.messages.create({ body: message, from, to: `whatsapp:${to}` });
          } else {
            if (!fromNumber) throw new Error("TWILIO_PHONE_NUMBER is not configured.");
            await client.calls.create({
              twiml: `<Response><Say voice="alice">${escapeXml(message)}</Say></Response>`,
              from: fromNumber,
              to,
            });
          }
          sentChannels.push(channel);
        } catch (e) {
          console.error(`SOS ${channel} failed:`, e);
          failures.push({
            channel,
            reason: e instanceof Error && !("code" in e) ? e.message : explainTwilioError(e),
          });
        }
      }
    }

    return NextResponse.json({
      success: recorded || sentChannels.length > 0,
      recorded,
      recordError: logError?.message ?? null,
      sentChannels,
      failedChannels: failures.map((f) => f.channel),
      failures,
      primaryContact: primary ? { full_name: primary.full_name, phone: primary.phone } : null,
    });
  } catch (e) {
    console.error("Alert error:", e);
    return NextResponse.json({ error: "Server error while sending the alert." }, { status: 500 });
  }
}
