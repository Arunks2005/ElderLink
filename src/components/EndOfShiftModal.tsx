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
  onGenerateHandover,
}: {
  staffId: string;
  staffName: string;
  totalResidents: number;
  loggedCount: number;
  sosCountToday: number;
  onClose: () => void;
  onConfirmSignOut: () => void;
  onGenerateHandover?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [assistCount, setAssistCount] = useState(0);
  const [notesPosted, setNotesPosted] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [signing, setSigning] = useState(false);
  const [loadWarning, setLoadWarning] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const todayStart = startOfTodayISO();

      // Supabase returns errors instead of throwing, so check { error }.
      const [assistResult, notesResult] = await Promise.all([
        supabase
          .from("assistance_requests")
          .select("id", { count: "exact", head: true })
          .eq("requested_by", staffId)
          .gte("created_at", todayStart),
        supabase
          .from("handover_notes")
          .select("id", { count: "exact", head: true })
          .gte("created_at", todayStart),
      ]);

      const problems: string[] = [];
      if (assistResult.error) problems.push("assistance requests");
      if (notesResult.error) problems.push("handover notes");
      setAssistCount(assistResult.count ?? 0);
      setNotesPosted(notesResult.count ?? 0);
      setLoadWarning(problems.length ? `Could not count ${problems.join(" and ")}.` : null);
      setLoading(false);
    }
    load();
  }, [staffId]);

  async function handleSignOff() {
    setSigning(true);
    const supabase = createClient();
    const summary = {
      total_residents: totalResidents,
      logged_count: loggedCount,
      sos_count_today: sosCountToday,
      assistance_requests: assistCount,
      handover_notes_posted: notesPosted,
    };
    // Optional `end_of_shift_reports` table. If it doesn't exist, keep a copy
    // of the summary as a handover note so the record isn't lost. Sign-out is
    // never blocked.
    const { error } = await supabase
      .from("end_of_shift_reports")
      .insert({ staff_id: staffId, summary });
    if (error) {
      await supabase.from("handover_notes").insert({
        note:
          `End of shift: ${staffName}. Logged ${loggedCount}/${totalResidents} residents, ` +
          `${sosCountToday} SOS today, ${assistCount} assistance requests, ${notesPosted} handover notes.`,
      });
    }
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

            {loadWarning && (
              <p className="text-xs text-gray-500 mb-3">{loadWarning}</p>
            )}

            {notesPosted === 0 && onGenerateHandover && (
              <div className="text-sm text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 mb-4 flex items-center gap-2">
                <span className="flex-1">No handover written yet for the next shift.</span>
                <button
                  onClick={onGenerateHandover}
                  className="text-xs font-semibold bg-indigo-600 text-white px-3 py-1.5 rounded-lg"
                >
                  Generate handover
                </button>
              </div>
            )}

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