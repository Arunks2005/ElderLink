"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
  photo_url: string | null;
};

type MedicalInfo = {
  conditions: string | null;
  allergies: string | null;
  mobility_notes: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
};

type Medication = {
  id: string;
  name: string;
  dosage: string | null;
  time_slots: string[] | null;
};

export default function ResidentQuickView({
  resident,
  onClose,
}: {
  resident: Resident;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [medical, setMedical] = useState<MedicalInfo | null>(null);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [recentLogs, setRecentLogs] = useState<
    { id: string; note: string | null; created_at: string }[]
  >([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      // ASSUMPTION: residents table has these medical-context columns, or
      // you split them into a `resident_medical_info` table — adjust the
      // select below to match. Wrapped so missing columns don't crash it.
      const medicalPromise = supabase
        .from("residents")
        .select(
          "conditions, allergies, mobility_notes, emergency_contact_name, emergency_contact_phone",
        )
        .eq("id", resident.id)
        .single();

      // ASSUMPTION: a `medications` table (see schema in chat). Falls back
      // to an empty list if it doesn't exist yet.
      const medsPromise = supabase
        .from("medications")
        .select("id, name, dosage, time_slots")
        .eq("resident_id", resident.id)
        .eq("active", true);

      const logsPromise = supabase
        .from("care_logs")
        .select("id, note, created_at")
        .eq("resident_id", resident.id)
        .order("created_at", { ascending: false })
        .limit(3);

      const [medicalResult, medsResult, logsResult] = await Promise.all([
        medicalPromise.then(
          (r) => r,
          () => ({ data: null }),
        ),
        medsPromise.then(
          (r) => r,
          () => ({ data: [] }),
        ),
        logsPromise.then(
          (r) => r,
          () => ({ data: [] }),
        ),
      ]);

      if (medicalResult && "data" in medicalResult && medicalResult.data) {
        setMedical(medicalResult.data as MedicalInfo);
      }
      if (medsResult && "data" in medsResult && medsResult.data) {
        setMedications(medsResult.data as Medication[]);
      }
      if (logsResult && "data" in logsResult && logsResult.data) {
        setRecentLogs(logsResult.data);
      }
      setLoading(false);
    }
    load();
  }, [resident.id]);

  function isDueSoon(slots: string[] | null) {
    if (!slots || slots.length === 0) return false;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return slots.some((slot) => {
      const [h, m] = slot.split(":").map(Number);
      const slotMinutes = h * 60 + m;
      return Math.abs(nowMinutes - slotMinutes) <= 30;
    });
  }

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
            <h2 className="font-bold text-gray-900 text-lg">
              {resident.full_name}
            </h2>
            <p className="text-sm text-gray-400">
              {resident.room_number
                ? `Room ${resident.room_number}`
                : "No room assigned"}
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
          <div className="py-10 text-center text-sm text-gray-400">
            Loading...
          </div>
        ) : (
          <div className="space-y-5">
            {/* Medications */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Medications
              </h3>
              {medications.length === 0 ? (
                <p className="text-sm text-gray-400">No medications on file.</p>
              ) : (
                <div className="space-y-2">
                  {medications.map((m) => {
                    const due = isDueSoon(m.time_slots);
                    return (
                      <div
                        key={m.id}
                        className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${
                          due
                            ? "border-amber-200 bg-amber-50"
                            : "border-gray-100"
                        }`}
                      >
                        <div>
                          <p className="font-medium text-gray-800">
                            {m.name}
                            {m.dosage ? ` · ${m.dosage}` : ""}
                          </p>
                          {m.time_slots && m.time_slots.length > 0 && (
                            <p className="text-xs text-gray-400">
                              {m.time_slots.join(", ")}
                            </p>
                          )}
                        </div>
                        {due && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
                            DUE
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Medical context */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Medical context
              </h3>
              <div className="space-y-2 text-sm text-gray-700">
                <InfoRow label="Conditions" value={medical?.conditions} />
                <InfoRow label="Allergies" value={medical?.allergies} />
                <InfoRow
                  label="Mobility notes"
                  value={medical?.mobility_notes}
                />
              </div>
            </section>

            {/* Emergency contact */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Emergency contact
              </h3>
              {medical?.emergency_contact_name ? (
                <p className="text-sm text-gray-700">
                  {medical.emergency_contact_name}
                  {medical.emergency_contact_phone
                    ? ` · ${medical.emergency_contact_phone}`
                    : ""}
                </p>
              ) : (
                <p className="text-sm text-gray-400">Not on file.</p>
              )}
            </section>

            {/* Recent care logs */}
            <section>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Recent care logs
              </h3>
              {recentLogs.length === 0 ? (
                <p className="text-sm text-gray-400">No entries yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentLogs.map((l) => (
                    <div
                      key={l.id}
                      className="text-sm text-gray-700 border-l-2 border-gray-200 pl-3"
                    >
                      <p>{l.note || "Care logged, no note added."}</p>
                      <p className="text-xs text-gray-400">
                        {new Date(l.created_at).toLocaleString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })}
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

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 min-w-[110px] flex-shrink-0">{label}</span>
      <span>{value || "None on file"}</span>
    </div>
  );
}
