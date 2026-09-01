"use client";

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
  phone: string;
};

type Step = "select" | "confirm" | "loading" | "success" | "error";

const ALERT_TYPES = [
  {
    label: "Fall",
    emoji: "🤕",
    color: "border-orange-400 bg-orange-50 text-orange-700",
  },
  {
    label: "Medical Emergency",
    emoji: "🏥",
    color: "border-red-500 bg-red-50 text-red-700",
  },
  {
    label: "Behavioural",
    emoji: "⚠️",
    color: "border-yellow-400 bg-yellow-50 text-yellow-700",
  },
  {
    label: "Other",
    emoji: "📋",
    color: "border-gray-400 bg-gray-50 text-gray-700",
  },
];

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
  const [primaryContact, setPrimaryContact] = useState<Contact | null>(null);
  const [sentTime, setSentTime] = useState("");
  const [failContact, setFailContact] = useState<Contact | null>(null);
  const [fetchingContact, setFetchingContact] = useState(false);

  // Fetch the primary contact when the modal mounts.
  // NOTE: this component should be rendered with key={resident.id} (or similar)
  // by its parent so that opening the modal for a new resident causes a fresh
  // mount instead of reusing state from a previous resident — that's what
  // keeps `step`, `alertType`, etc. at their defaults without resetting them
  // synchronously inside an effect.
  useEffect(() => {
    if (!isOpen) return;

    async function fetchContact() {
      setFetchingContact(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("family_contacts")
        .select("full_name, phone")
        .eq("resident_id", resident.id)
        .eq("is_primary", true)
        .single();

      if (error) {
        console.error("Failed to fetch primary contact:", error.message);
      }

      if (data) setPrimaryContact(data);
      setFetchingContact(false);
    }

    fetchContact();
  }, [isOpen, resident.id]);

  async function sendAlert() {
    setStep("loading");

    try {
      const res = await fetch("/api/emergency-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentId: resident.id,
          alertType,
        }),
      });

      const result = await res.json();

      if (!res.ok) throw new Error(result.error || "Failed to send");

      setSentTime(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );

      if (result.primaryContact) {
        setPrimaryContact(result.primaryContact);
      }

      setStep("success");
    } catch (e) {
      console.error("SOS error:", e);
      setFailContact(primaryContact);
      setStep("error");
    }
  }

  function selectType(label: string) {
    setAlertType(label);
  }

  if (!isOpen) return null;

  const initials = resident.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={step === "success" || step === "error" ? onClose : undefined}
      />

      {/* Modal sheet */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-[modalIn_0.25s_ease-out]">
          {/* ─── STEP 1: Select alert type ─── */}
          {step === "select" && (
            <div className="p-6">
              {/* Resident header */}
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
                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-0.5">
                    🚨 SOS Alert
                  </p>
                  <p className="font-bold text-gray-900 text-base">
                    {resident.full_name}
                  </p>
                </div>
              </div>

              {/* Alert type grid */}
              <p className="text-sm font-semibold text-gray-600 mb-3">
                What is happening?
              </p>

              <div className="grid grid-cols-2 gap-3 mb-6">
                {ALERT_TYPES.map(({ label, emoji, color }) => (
                  <button
                    key={label}
                    onClick={() => selectType(label)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all active:scale-95 ${
                      alertType === label
                        ? color
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    <span className="text-3xl">{emoji}</span>
                    <span className="text-xs font-semibold text-center leading-tight">
                      {label}
                    </span>
                  </button>
                ))}
              </div>

              {/* Action buttons */}
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
                    alertType
                      ? "bg-red-600 hover:bg-red-700 text-white shadow-sm"
                      : "bg-gray-200 text-gray-400 cursor-not-allowed"
                  }`}
                >
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* ─── STEP 2: Confirm ─── */}
          {step === "confirm" && (
            <div className="p-6">
              <div className="text-center mb-6">
                <div className="text-5xl mb-3">🚨</div>
                <h2 className="text-xl font-bold text-gray-900">
                  Send SOS Alert?
                </h2>
                <p className="text-gray-400 text-sm mt-1">
                  An SMS will be sent immediately to the family
                </p>
              </div>

              {/* Summary box */}
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-6 space-y-3">
                <InfoRow label="Resident" value={resident.full_name} />
                <div className="border-t border-gray-100" />
                <InfoRow
                  label="Alert type"
                  value={alertType}
                  valueClass="text-red-600 font-bold"
                />
                <div className="border-t border-gray-100" />
                <InfoRow
                  label="SMS will go to"
                  value={
                    fetchingContact
                      ? "Fetching contact..."
                      : primaryContact
                        ? `${primaryContact.full_name} (${primaryContact.phone})`
                        : "No primary contact found"
                  }
                />
              </div>

              {/* Warning if no contact */}
              {!fetchingContact && !primaryContact && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                  <p className="text-amber-700 text-xs font-medium">
                    ⚠️ No primary contact is set for this resident. Please ask
                    the admin to add one before sending an alert.
                  </p>
                </div>
              )}

              {/* Buttons */}
              <button
                onClick={sendAlert}
                disabled={!primaryContact || fetchingContact}
                className={`w-full font-bold py-4 rounded-2xl text-base mb-3 transition-all active:scale-95 ${
                  primaryContact && !fetchingContact
                    ? "bg-red-600 hover:bg-red-700 text-white shadow-sm"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
                }`}
              >
                Confirm — Send Alert
              </button>
              <button
                onClick={() => setStep("select")}
                className="w-full text-gray-400 text-sm py-2 hover:text-gray-600 transition-colors"
              >
                ← Change alert type
              </button>
            </div>
          )}

          {/* ─── STEP 3: Loading ─── */}
          {step === "loading" && (
            <div className="p-10 text-center">
              <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-5" />
              <p className="font-bold text-gray-900 text-lg">
                Sending alert...
              </p>
              <p className="text-gray-400 text-sm mt-1">
                Notifying {primaryContact?.full_name ?? "family"} via SMS
              </p>
            </div>
          )}

          {/* ─── STEP 4: Success ─── */}
          {step === "success" && (
            <div className="p-6">
              {/* Green top bar */}
              <div className="bg-green-500 -mx-6 -mt-6 px-6 pt-8 pb-6 mb-6 text-center rounded-t-3xl">
                <div className="text-5xl mb-2">✅</div>
                <h2 className="text-xl font-bold text-white">Alert Sent</h2>
                <p className="text-green-100 text-sm mt-1">at {sentTime}</p>
              </div>

              {/* Details */}
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 mb-6 space-y-2">
                <p className="text-green-800 text-sm font-medium">
                  📱 SMS sent to <strong>{primaryContact?.full_name}</strong>
                </p>
                <p className="text-green-600 text-xs">
                  {primaryContact?.phone}
                </p>
              </div>

              <div className="bg-gray-50 rounded-2xl p-4 mb-6 space-y-2">
                <InfoRow label="Resident" value={resident.full_name} />
                <div className="border-t border-gray-200" />
                <InfoRow
                  label="Alert type"
                  value={alertType}
                  valueClass="text-red-600 font-semibold"
                />
              </div>

              <button
                onClick={onClose}
                className="w-full bg-[#4F9C8B] hover:bg-[#438a7a] text-white font-bold py-4 rounded-2xl transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          )}

          {/* ─── STEP 5: Error ─── */}
          {step === "error" && (
            <div className="p-6">
              {/* Red top bar */}
              <div className="bg-red-500 -mx-6 -mt-6 px-6 pt-8 pb-6 mb-6 text-center rounded-t-3xl">
                <div className="text-5xl mb-2">⚠️</div>
                <h2 className="text-xl font-bold text-white">Alert Failed</h2>
                <p className="text-red-100 text-sm mt-1">
                  Automatic SMS could not be delivered
                </p>
              </div>

              {/* Manual call box */}
              <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6">
                <p className="text-red-500 text-xs font-bold uppercase tracking-wide mb-2">
                  Call manually now
                </p>
                <p className="text-gray-900 font-bold text-base">
                  {failContact?.full_name ?? "Family contact"}
                </p>
                <p className="text-red-700 font-bold text-2xl mt-1">
                  {failContact?.phone ?? "No number available"}
                </p>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-6">
                <p className="text-amber-700 text-xs">
                  ⚠️ The alert has still been saved to the system log even
                  though the SMS failed.
                </p>
              </div>

              <button
                onClick={onClose}
                className="w-full border border-gray-200 text-gray-700 font-semibold py-4 rounded-2xl hover:bg-gray-50 transition-all active:scale-95"
              >
                Close
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

function InfoRow({
  label,
  value,
  valueClass = "text-gray-900 font-medium",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500 text-sm flex-shrink-0">{label}</span>
      <span className={`text-sm text-right ${valueClass}`}>{value}</span>
    </div>
  );
}
