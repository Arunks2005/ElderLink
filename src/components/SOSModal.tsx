"use client";

/**
 * Manual SOS: staff pick what happened, choose how to reach the family
 * (SMS, WhatsApp, phone call) and send. The alert is always recorded, even
 * if a message fails, and the result screen says exactly which channels
 * worked, why any failed, and offers a one-tap manual call.
 */

import { useState, useEffect } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type Resident = {
  id: string;
  full_name: string;
  photo_url: string | null;
};

type Contact = {
  full_name: string;
  phone: string | null;
  relationship?: string | null;
};

type Channel = "sms" | "whatsapp" | "voice";
type Step = "select" | "confirm" | "loading" | "result";

type SendResult = {
  recorded: boolean;
  recordError: string | null;
  sentChannels: Channel[];
  failures: { channel: Channel; reason: string }[];
  error?: string;
};

const ALERT_TYPES = [
  { label: "Fall", emoji: "🤕", color: "border-orange-400 bg-orange-50 text-orange-700" },
  { label: "Medical Emergency", emoji: "🏥", color: "border-red-500 bg-red-50 text-red-700" },
  { label: "Behavioural", emoji: "⚠️", color: "border-yellow-400 bg-yellow-50 text-yellow-700" },
  { label: "Other", emoji: "📋", color: "border-gray-400 bg-gray-50 text-gray-700" },
];

const CHANNELS: { id: Channel; label: string; emoji: string; hint: string }[] = [
  { id: "sms", label: "SMS", emoji: "💬", hint: "Text message" },
  { id: "whatsapp", label: "WhatsApp", emoji: "🟢", hint: "WhatsApp message" },
  { id: "voice", label: "Phone call", emoji: "📞", hint: "Automated voice call" },
];

const CHANNEL_LABEL: Record<Channel, string> = { sms: "SMS", whatsapp: "WhatsApp", voice: "Phone call" };

export default function SOSModal({
  resident,
  isOpen,
  onClose,
}: {
  resident: Resident;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("select");
  const [alertType, setAlertType] = useState("");
  const [channels, setChannels] = useState<Channel[]>(["sms"]);
  const [contact, setContact] = useState<Contact | null>(null);
  const [fetchingContact, setFetchingContact] = useState(true);
  const [sentTime, setSentTime] = useState("");
  const [result, setResult] = useState<SendResult | null>(null);

  // Primary contact first; fall back to any contact. (The old code used
  // .single(), which errors when a resident has no primary contact.)
  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("family_contacts")
        .select("full_name, phone, relationship, is_primary")
        .eq("resident_id", resident.id)
        .order("is_primary", { ascending: false })
        .limit(1);
      if (error) console.error("Failed to fetch family contact:", error.message);
      setContact(((data ?? [])[0] as Contact | undefined) ?? null);
      setFetchingContact(false);
    })();
  }, [isOpen, resident.id]);

  const toggleChannel = (c: Channel) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  async function sendAlert() {
    setStep("loading");
    let r: SendResult;
    try {
      const res = await fetch("/api/emergency-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: resident.id, alertType, channels }),
      });
      const json = await res.json().catch(() => ({}));
      r = res.ok
        ? {
            recorded: Boolean(json.recorded),
            recordError: json.recordError ?? null,
            sentChannels: json.sentChannels ?? [],
            failures: json.failures ?? [],
          }
        : {
            recorded: false,
            recordError: null,
            sentChannels: [],
            failures: [],
            error: json.error ?? `Request failed (${res.status})`,
          };
    } catch {
      r = { recorded: false, recordError: null, sentChannels: [], failures: [], error: "Network error: could not reach ElderLink." };
    }
    setSentTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    setResult(r);
    setStep("result");
  }

  if (!isOpen) return null;

  const initials = resident.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const hasPhone = Boolean(contact?.phone);
  const allSent = result && !result.error && result.failures.length === 0 && result.sentChannels.length > 0;
  const someSent = result && result.sentChannels.length > 0;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={step === "result" ? onClose : undefined}
      />

      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-[modalIn_0.25s_ease-out] max-h-[92vh] overflow-y-auto">
          {/* ─── STEP 1: What happened ─── */}
          {step === "select" && (
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                {resident.photo_url ? (
                  <Image
                    src={resident.photo_url}
                    alt={resident.full_name}
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 font-bold text-lg flex items-center justify-center flex-shrink-0">
                    {initials}
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-0.5">🚨 SOS Alert</p>
                  <p className="font-bold text-gray-900 text-base">{resident.full_name}</p>
                </div>
              </div>

              <p className="text-sm font-semibold text-gray-600 mb-3">What is happening?</p>
              <div className="grid grid-cols-2 gap-3 mb-6">
                {ALERT_TYPES.map(({ label, emoji, color }) => (
                  <button
                    key={label}
                    onClick={() => setAlertType(label)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all active:scale-95 ${
                      alertType === label
                        ? color
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-3xl">{emoji}</span>
                    <span className="text-xs font-semibold text-center leading-tight">{label}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-600 text-sm font-semibold hover:bg-gray-50 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={() => alertType && setStep("confirm")}
                  disabled={!alertType}
                  className={`flex-1 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 ${
                    alertType ? "bg-red-600 hover:bg-red-700 text-white shadow-sm" : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP 2: How to notify + confirm ─── */}
          {step === "confirm" && (
            <div className="p-6">
              <div className="text-center mb-5">
                <div className="text-5xl mb-2">🚨</div>
                <h2 className="text-xl font-bold text-gray-900">Send SOS alert</h2>
                <p className="text-gray-500 text-sm mt-1">
                  {resident.full_name} · <span className="text-red-600 font-semibold">{alertType}</span>
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-4">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">Family contact</p>
                {fetchingContact ? (
                  <p className="text-sm text-gray-500">Looking up contact…</p>
                ) : contact ? (
                  <p className="text-sm text-gray-900 font-semibold">
                    {contact.full_name}
                    {contact.relationship ? ` (${contact.relationship})` : ""}
                    <span className="block font-normal text-gray-600">{contact.phone ?? "No phone number"}</span>
                  </p>
                ) : (
                  <p className="text-sm text-amber-700">No family contact registered. The alert will still be recorded for staff.</p>
                )}
              </div>

              <p className="text-sm font-semibold text-gray-600 mb-2">Notify the family by</p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {CHANNELS.map((c) => {
                  const on = channels.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleChannel(c.id)}
                      disabled={!hasPhone}
                      aria-pressed={on}
                      title={c.hint}
                      className={`flex flex-col items-center gap-1 py-3 rounded-2xl border-2 text-xs font-bold transition-all active:scale-95 disabled:opacity-40 ${
                        on && hasPhone ? "border-red-500 bg-red-50 text-red-700" : "border-gray-200 bg-white text-gray-600"
                      }`}
                    >
                      <span className="text-2xl">{c.emoji}</span>
                      {c.label}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={sendAlert}
                disabled={fetchingContact || (hasPhone && channels.length === 0)}
                className="w-full font-bold py-4 rounded-2xl text-base mb-2 transition-all active:scale-95 bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:bg-gray-200 disabled:text-gray-400"
              >
                {hasPhone
                  ? `Send alert (${channels.map((c) => CHANNEL_LABEL[c]).join(" + ") || "choose a channel"})`
                  : "Record alert (no family phone)"}
              </button>
              {hasPhone && (
                <a
                  href={`tel:${contact!.phone}`}
                  className="block w-full text-center border border-gray-200 text-gray-700 font-semibold py-3 rounded-2xl mb-2"
                >
                  📞 Call {contact!.full_name} yourself
                </a>
              )}
              <button
                onClick={() => setStep("select")}
                className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition-colors"
              >
                ← Change alert type
              </button>
            </div>
          )}

          {/* ─── STEP 3: Sending ─── */}
          {step === "loading" && (
            <div className="p-10 text-center">
              <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
              <p className="font-bold text-gray-900 text-lg">Sending alert…</p>
              <p className="text-gray-400 text-sm mt-1">
                {hasPhone ? `Notifying ${contact?.full_name ?? "family"}` : "Recording the alert"}
              </p>
            </div>
          )}

          {/* ─── STEP 4: Result ─── */}
          {step === "result" && result && (
            <div className="p-6">
              <div
                className={`-mx-6 -mt-6 px-6 pt-8 pb-6 mb-5 text-center rounded-t-3xl ${
                  allSent ? "bg-green-500" : someSent ? "bg-amber-500" : result.recorded ? "bg-amber-500" : "bg-red-500"
                }`}
              >
                <div className="text-5xl mb-2">{allSent ? "✅" : someSent || result.recorded ? "⚠️" : "❌"}</div>
                <h2 className="text-xl font-bold text-white">
                  {allSent
                    ? "Alert sent"
                    : someSent
                    ? "Alert partly sent"
                    : result.recorded
                    ? "Alert recorded, family not reached"
                    : "Alert failed"}
                </h2>
                <p className="text-white/80 text-sm mt-1">at {sentTime}</p>
              </div>

              {result.error && (
                <p className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4">{result.error}</p>
              )}

              <div className="space-y-2 mb-4">
                {result.sentChannels.map((c) => (
                  <p key={c} className="text-sm bg-green-50 border border-green-200 text-green-800 rounded-xl px-3 py-2">
                    ✓ {CHANNEL_LABEL[c]} sent to {contact?.full_name}
                  </p>
                ))}
                {result.failures.map((f) => (
                  <p key={f.channel} className="text-sm bg-red-50 border border-red-200 text-red-800 rounded-xl px-3 py-2">
                    ✗ {CHANNEL_LABEL[f.channel]}: {f.reason}
                  </p>
                ))}
                <p
                  className={`text-xs rounded-xl px-3 py-2 ${
                    result.recorded ? "bg-gray-50 text-gray-600" : "bg-amber-50 text-amber-800"
                  }`}
                >
                  {result.recorded
                    ? "The alert is saved and shows on the staff dashboard and in the shift handover."
                    : `The alert could not be saved${result.recordError ? ` (${result.recordError})` : ""}. Tell the nurse in charge.`}
                </p>
              </div>

              {!allSent && hasPhone && (
                <a
                  href={`tel:${contact!.phone}`}
                  className="block bg-red-600 text-white text-center font-bold py-4 rounded-2xl mb-3"
                >
                  📞 Call {contact!.full_name} now ({contact!.phone})
                </a>
              )}

              <button
                onClick={onClose}
                className="w-full bg-[#4F9C8B] hover:bg-[#438a7a] text-white font-bold py-4 rounded-2xl transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>

      <style jsx global>{`
        @keyframes modalIn {
          from {
            opacity: 0;
            transform: scale(0.94) translateY(16px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </>
  );
}
