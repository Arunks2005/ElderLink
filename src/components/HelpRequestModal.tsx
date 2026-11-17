"use client";

/**
 * "Request help" for a resident: asks nearby staff / the supervisor for an
 * extra pair of hands. Shows live on every dashboard (HelpRequestsBar).
 * Not for emergencies: that's SOS.
 */

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMe } from "@/lib/care/me";

const QUICK = ["Second person for a transfer", "Help with bathing", "Resident is agitated", "Need the nurse to check"];

export default function HelpRequestModal({
  resident,
  onClose,
  onSent,
}: {
  resident: { id: string; full_name: string; room_number?: string | null };
  onClose: () => void;
  onSent?: (error: string | null) => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setSending(true);
    setError(null);
    const supabase = createClient();
    const me = await getMe(supabase);
    const { error: e } = await supabase.from("assistance_requests").insert({
      resident_id: resident.id,
      message: message.trim() || "Assistance requested",
      status: "open",
      requested_by: me?.id ?? null,
      requested_by_name: me?.name ?? null,
      location: resident.room_number ?? null,
    });
    setSending(false);
    if (e) {
      setError(e.message);
      onSent?.(e.message);
      return;
    }
    onSent?.(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-gray-100" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
            <HelpCircle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-extrabold text-gray-900 text-lg">Request help</h3>
            <p className="text-xs text-gray-500">
              For {resident.full_name}
              {resident.room_number ? ` · ${resident.room_number}` : ""}
            </p>
          </div>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed mb-3">
          Shows instantly on every staff dashboard. Not for emergencies: use SOS.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {QUICK.map((q) => (
            <button
              key={q}
              onClick={() => setMessage(q)}
              className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${
                message === q ? "border-amber-400 bg-amber-50 text-amber-800" : "border-gray-200 text-gray-600"
              }`}
            >
              {q}
            </button>
          ))}
        </div>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do you need?"
          rows={2}
          className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#4F9C8B] mb-4 bg-[#FAFAF8]"
        />
        {error && <p className="text-xs text-red-600 mb-3">Could not send: {error}</p>}
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-40"
          >
            {sending ? "Sending…" : "Send request"}
          </button>
        </div>
      </div>
    </div>
  );
}
