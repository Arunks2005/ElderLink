import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { requireCareRole } from "@/lib/auth/require-care-role";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export async function POST(req: NextRequest) {
  // Only signed-in care staff (staff or admin) may send SOS messages and
  // phone calls to families. Previously anyone could call this route.
  const auth = await requireCareRole();
  if (!auth.ok) return auth.response;

  try {
    const { residentId, alertType, channels } = await req.json();
    const requestedChannels: string[] =
      Array.isArray(channels) && channels.length > 0 ? channels : ["sms"];

    if (!residentId || !alertType) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const { data: resident } = await supabase
      .from("residents")
      .select("full_name")
      .eq("id", residentId)
      .single();

    if (!resident) {
      return NextResponse.json(
        { error: "Resident not found" },
        { status: 404 },
      );
    }

    const { data: contacts, error: contactsError } = await supabase
      .from("family_contacts")
      .select("full_name, phone, is_primary")
      .eq("resident_id", residentId);

    if (contactsError) {
      console.error("Contacts query failed:", contactsError.message);
    }

    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ error: "No contacts found" }, { status: 404 });
    }

    const primary = contacts.find((c) => c.is_primary) || contacts[0];
    const time = new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
    });

    const message =
      `ElderLink Alert: Hi ${primary.full_name}, ${resident.full_name} has had a ${alertType} at ${time}. ` +
      `Our care team is with them. Please call ${process.env.CARE_HOME_PHONE}. - ${process.env.CARE_HOME_NAME}`;

    const sentChannels: string[] = [];
    const failedChannels: string[] = [];

    // SMS
    if (requestedChannels.includes("sms")) {
      try {
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER!,
          to: primary.phone,
        });
        sentChannels.push("sms");
      } catch (e) {
        console.error("SMS failed:", e);
        failedChannels.push("sms");
      }
    }

    // WhatsApp — trial accounts require the recipient to have joined the
    // Twilio sandbox first (by sending the join code to the sandbox number).
    // Requires TWILIO_WHATSAPP_NUMBER, e.g. "whatsapp:+14155238886".
    if (requestedChannels.includes("whatsapp")) {
      try {
        if (!process.env.TWILIO_WHATSAPP_NUMBER) {
          throw new Error("TWILIO_WHATSAPP_NUMBER is not configured");
        }
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_WHATSAPP_NUMBER,
          to: `whatsapp:${primary.phone}`,
        });
        sentChannels.push("whatsapp");
      } catch (e) {
        console.error("WhatsApp failed:", e);
        failedChannels.push("whatsapp");
      }
    }

    // Voice call — reads the same message aloud via TwiML <Say>.
    if (requestedChannels.includes("voice")) {
      try {
        const twiml = `<Response><Say voice="alice">${escapeXml(message)}</Say></Response>`;
        await twilioClient.calls.create({
          twiml,
          from: process.env.TWILIO_PHONE_NUMBER!,
          to: primary.phone,
        });
        sentChannels.push("voice");
      } catch (e) {
        console.error("Voice call failed:", e);
        failedChannels.push("voice");
      }
    }

    // emergency_alerts columns: resident_id, raised_by (FK staff), type,
    // status ('open' | 'acknowledged' | 'resolved'), created_at, resolved_at.
    const { error: logError } = await supabase.from("emergency_alerts").insert({
      resident_id: residentId,
      type: String(alertType).slice(0, 60),
      status: "open",
      raised_by: auth.role === "staff" ? auth.userId : null,
    });
    if (logError) console.error("Could not record emergency alert:", logError.message);

    return NextResponse.json({
      success: true,
      sentChannels,
      failedChannels,
      primaryContact: {
        full_name: primary.full_name,
        phone: primary.phone,
      },
    });
  } catch (e) {
    console.error("Alert error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
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
