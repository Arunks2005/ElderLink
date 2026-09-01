import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export async function POST(req: NextRequest) {
  try {
    const { residentId, alertType } = await req.json();

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

    let smsSent = false;

    try {
      await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER!,
        to: primary.phone,
      });
      smsSent = true;
    } catch (e) {
      console.error("SMS failed:", e);
    }

    await supabase.from("emergency_alerts").insert({
      resident_id: residentId,
      alert_type: alertType,
      sms_sent: smsSent,
      resolved: false,
    });

    return NextResponse.json({
      success: true,
      smsSent,
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
