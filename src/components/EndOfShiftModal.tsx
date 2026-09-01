"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function EndOfShiftModal({
  staffId,
  staffName,
  totalResidents,
  loggedCount,
  sosCountToday,
  onClose,
  onConfirmSignOut,
}: {
  staffId: string;
  staffName: string;
  totalResidents: number;
  loggedCount: number;
  sosCountToday: number;
  onClose: () => void;
  onConfirmSignOut: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [assistCount, setAssistCount] = useState(0);
  const [notesPosted, setNotesPosted] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const todayStart = startOfTodayISO();

      const [assistResult, notesResult] = await Promise.all([
        supabase
          .from("assistance_requests")
          .select("id", { count: "exact", head: true })
          .eq("requested_by", staffId)
          .gte("created_at", todayStart)
          .then(
            (r) => r,
            () => ({ count: 0 }),
          ),
        supabase
          .from("handover_notes")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayStart)
          .then(
            (r) => r,
            () => ({ count: 0 }),
          ),
      ]);

      setAssistCount(assistResult.count ?? 0);
      setNotesPosted(notesResult.count ?? 0);
      setLoading(false);
    }
    load();
  }, [staffId]);

  async function handleSignOff() {
    setSigning(true);
    const supabase = createClient();
    // ASSUMPTION: an `end_of_shift_reports` table (see schema in chat).
    // Wrapped so a missing table doesn't block sign-out.
    await supabase
      .from("end_of_shift_reports")
      .insert({
        staff_id: staffId,
        summary: {
          total_residents: totalResidents,
          logged_count: loggedCount,
          sos_count_today: sosCountToday,
          assistance_requests: assistCount,
          handover_notes_posted: notesPosted,
        },
      })
      .then(
        (r) => r,
        () => null,
      );
    setSigning(false);
    onConfirmSignOut();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-bold text-gray-900 text-lg mb-1">
          End of shift summary
        </h2>
        <p className="text-sm text-gray-400 mb-4">{staffName}</p>

        {loading ? (
          <div className="py-8 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : (
          <>
            <div className="space-y-2 mb-5">
              <SummaryRow
                label="Residents logged"
                value={`${loggedCount} / ${totalResidents}`}
              />
              <SummaryRow
                label="SOS alerts raised today"
                value={String(sosCountToday)}
              />
              <SummaryRow
                label="Assistance requests you sent"
                value={String(assistCount)}
              />
              <SummaryRow
                label="Handover notes posted today"
                value={String(notesPosted)}
              />
            </div>

            {loggedCount < totalResidents && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
                {totalResidents - loggedCount} resident
                {totalResidents - loggedCount === 1 ? "" : "s"} still need a
                care log before you sign out.
              </p>
            )}

            <label className="flex items-start gap-2 text-sm text-gray-700 mb-5">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              I confirm this summary is accurate and reflects the actions I
              took this shift.
            </label>

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600"
              >
                Back
              </button>
              <button
                onClick={handleSignOff}
                disabled={!confirmed || signing}
                className="flex-1 py-2.5 rounded-xl bg-[#357366] text-white text-sm font-semibold disabled:opacity-40"
              >
                {signing ? "Signing off..." : "Sign off & sign out"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm border-b border-gray-50 pb-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-semibold text-gray-900">{value}</span>
    </div>
  );
}