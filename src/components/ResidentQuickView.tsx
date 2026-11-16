"use client";

/**
 * Quick view of one resident for staff: medical and dietary notes, the
 * primary family contact and the latest care logs.
 *
 * Reads only columns that exist in the live schema (residents,
 * family_contacts, care_logs_demo). There is no medications table, so the
 * medication picture comes from the "Medication" outcome on recent care logs.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
  photo_url: string | null;
};

type ResidentDetails = {
  dob: string | null;
  medical_notes: string | null;
  dietary_needs: string | null;
  status: string | null;
};

type Contact = {
  full_name: string;
  relationship: string | null;
  phone: string | null;
};

type RecentLog = {
  id: string;
  created_at: string;
  meals: string | null;
  fluids: string | null;
  mood: string | null;
  medication: string | null;
  notes: string | null;
  entry_source: string | null;
};

export default function ResidentQuickView({
  resident,
  onClose,
}: {
  resident: Resident;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [details, setDetails] = useState<ResidentDetails | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const [detailsRes, contactRes, logsRes] = await Promise.all([
        supabase
          .from("residents")
          .select("dob, medical_notes, dietary_needs, status")
          .eq("id", resident.id)
          .maybeSingle(),
        supabase
          .from("family_contacts")
          .select("full_name, relationship, phone, is_primary")
          .eq("resident_id", resident.id)
          .order("is_primary", { ascending: false })
          .limit(1),
        supabase
          .from("care_logs_demo")
          .select("id, created_at, meals, fluids, mood, medication, notes, entry_source")
          .eq("resident_id", resident.id)
          .order("created_at", { ascending: false })
          .limit(3),
      ]);

      const problems: string[] = [];
      if (detailsRes.error) problems.push("resident details");
      if (contactRes.error) problems.push("family contact");
      if (logsRes.error) problems.push("care logs");
      setLoadError(problems.length ? `Could not load ${problems.join(", ")}.` : null);

      const d = (detailsRes.data as ResidentDetails | null) ?? null;
      setDetails(d);
      setAge(d?.dob ? Math.floor((Date.now() - new Date(d.dob).getTime()) / (365.25 * 86_400_000)) : null);
      setContact(((contactRes.data ?? [])[0] as Contact | undefined) ?? null);
      setRecentLogs((logsRes.data as RecentLog[] | null) ?? []);
      setLoading(false);
    }
    load();
  }, [resident.id]);

  const missedMeds = recentLogs.filter((l) => l.medication === "Refused" || l.medication === "Missed").length;

  return (
    <div
      className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">{resident.full_name}</h2>
            <p className="text-sm text-gray-400">
              {resident.room_number ? `Room ${resident.room_number}` : "No room assigned"}
              {age && age > 0 ? ` · ${age} yrs` : ""}
              {details?.status && details.status !== "active" ? ` · ${details.status.replace(/_/g, " ")}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-sm border border-gray-200 rounded-lg px-2.5 py-1"
          >
            Close
          </button>
        </div>

        {loading ? (
          <div className="py-10 text-center text-sm text-gray-400">Loading...</div>
        ) : (
          <div className="space-y-5">
            {loadError && <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">{loadError}</p>}

            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Medical context</h3>
              <div className="space-y-2 text-sm text-gray-700">
                <InfoRow label="Medical notes" value={details?.medical_notes} />
                <InfoRow label="Dietary needs" value={details?.dietary_needs} />
              </div>
            </section>

            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Medication (recent logs)</h3>
              {recentLogs.length === 0 ? (
                <p className="text-sm text-gray-400">No recent care logs.</p>
              ) : missedMeds > 0 ? (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  {missedMeds} of the last {recentLogs.length} logs recorded a refused or missed dose.
                </p>
              ) : (
                <p className="text-sm text-gray-700">Given as scheduled in the last {recentLogs.length} logs.</p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Family contact</h3>
              {contact ? (
                <p className="text-sm text-gray-700">
                  {contact.full_name}
                  {contact.relationship ? ` (${contact.relationship})` : ""}
                  {contact.phone ? ` · ${contact.phone}` : ""}
                </p>
              ) : (
                <p className="text-sm text-gray-400">No family contact registered.</p>
              )}
            </section>

            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Recent care logs</h3>
              {recentLogs.length === 0 ? (
                <p className="text-sm text-gray-400">No entries yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentLogs.map((l) => (
                    <div key={l.id} className="text-sm text-gray-700 border-l-2 border-gray-200 pl-3">
                      <p>
                        {[
                          l.meals && `Meals: ${l.meals}`,
                          l.fluids && `Fluids: ${l.fluids}`,
                          l.mood && `Mood: ${l.mood}`,
                          l.medication && `Meds: ${l.medication}`,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Care logged"}
                      </p>
                      {l.notes && <p className="text-xs text-gray-600 mt-0.5">{l.notes}</p>}
                      <p className="text-xs text-gray-400">
                        {new Date(l.created_at).toLocaleString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })}
                        {l.entry_source && l.entry_source !== "manual" ? " · simulated" : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 min-w-[110px] flex-shrink-0">{label}</span>
      <span className="whitespace-pre-wrap">{value || "None on file"}</span>
    </div>
  );
}
