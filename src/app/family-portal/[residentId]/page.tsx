"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
  photo_url: string | null;
  dob: string | null;
  address: string | null;
  medical_notes: string | null;
};

type CareLog = {
  id: string;
  resident_name: string;
  room: string;
  meals: string | null;
  fluids: string | null;
  mood: string | null;
  medication: string | null;
  notes: string | null;
  created_at: string;
  photo_url: string | null;
  systolic: number | null;
  diastolic: number | null;
  heart_rate: number | null;
  temperature: number | null;
  pain_scale: number | null;
  pain_note: string | null;
  resident_id: string | null;
  staff_id: string | null;
  entry_source: "demo" | "manual" | "sensor" | null;
  source_id: string | null;
};

type Incident = {
  id: string;
  resident_id: string;
  description: string | null;
  created_at: string;
};

type EmergencyAlert = {
  id: string;
  resident_id: string;
  type: string | null;
  status: string | null;
  created_at: string;
};

type FamilyContact = {
  id: string;
  resident_id: string;
  profile_id: string | null;
  full_name: string;
  relationship: string | null;
  email: string | null;
};

type TimelineItem =
  | ({ _type: "care_log" } & CareLog)
  | ({ _type: "incident" } & Incident)
  | ({ _type: "emergency_alert" } & EmergencyAlert);

const EVENT_META: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  care_log: {
    label: "Care Log",
    color: "text-[#357366]",
    dot: "bg-[#4F9C8B]",
  },
  incident: {
    label: "Incident",
    color: "text-amber-700",
    dot: "bg-amber-500",
  },
  emergency_alert: {
    label: "Emergency Alert",
    color: "text-red-600",
    dot: "bg-red-600",
  },
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function initials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function buildCareSummary(logs: CareLog[], todayCount: number) {
  function average(values: Array<number | null>) {
    const usable = values.filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    );

    if (usable.length === 0) return null;

    return usable.reduce((sum, value) => sum + value, 0) / usable.length;
  }

  const manualCount = logs.filter((log) => log.entry_source === "manual").length;
  const sensorCount = logs.filter((log) => log.entry_source === "sensor").length;
  const demoCount = logs.filter((log) => log.entry_source === "demo").length;

  const noteLogs = logs.filter((log) => Boolean(log.notes?.trim()));
  const painConcernCount = logs.filter(
    (log) => log.pain_scale != null && log.pain_scale >= 6,
  ).length;

  const dateValues = logs
    .map((log) => new Date(log.created_at).getTime())
    .filter((value) => Number.isFinite(value));

  const latestAt =
    dateValues.length > 0 ? new Date(Math.max(...dateValues)) : null;
  const earliestAt =
    dateValues.length > 0 ? new Date(Math.min(...dateValues)) : null;

  return {
    totalLogs: logs.length,
    todayLogs: todayCount,
    manualCount,
    sensorCount,
    demoCount,
    noteCount: noteLogs.length,
    painConcernCount,
    avgSystolic: average(logs.map((log) => log.systolic)),
    avgDiastolic: average(logs.map((log) => log.diastolic)),
    avgHeartRate: average(logs.map((log) => log.heart_rate)),
    avgTemperature: average(logs.map((log) => log.temperature)),
    avgPain: average(logs.map((log) => log.pain_scale)),
    earliestAt,
    latestAt,
    latestNotes: noteLogs.slice(0, 3),
  };
}

export default function FamilyPortalPage({
  params,
}: {
  params: Promise<{ residentId: string }>;
}) {
  const router = useRouter();
  const { residentId } = use(params);

  const [resident, setResident] = useState<Resident | null>(null);
  const [careLogs, setCareLogs] = useState<CareLog[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [familyContact, setFamilyContact] = useState<FamilyContact | null>(
    null,
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    try {
      // ============================================================
      // 1. CHECK AUTHENTICATION
      // ============================================================

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      console.log("AUTH USER:", user);
      console.log("AUTH ERROR:", authError);

      if (authError || !user) {
        router.push("/family-login");
        return;
      }

      console.log("Logged in user ID:", user.id);
      console.log("Requested resident ID:", residentId);

      // ============================================================
      // 2. FIND FAMILY CONTACT
      // ============================================================

      const { data: contact, error: familyError } = await supabase
        .from("family_contacts")
        .select("id, resident_id, profile_id, full_name, relationship, email")
        .eq("profile_id", user.id)
        .maybeSingle();

      console.log("FAMILY CONTACT:", contact);
      console.log("FAMILY CONTACT ERROR:", familyError);

      if (familyError) {
        console.error("Family contact query failed:", familyError);

        setError(
          "Unable to verify your family account. Please contact the administrator.",
        );

        setLoading(false);
        return;
      }

      if (!contact) {
        setError(
          "Your family account is not linked to a resident yet. Please contact the administrator.",
        );

        setLoading(false);
        return;
      }

      setFamilyContact(contact as FamilyContact);

      // ============================================================
      // 3. SECURITY CHECK
      // ============================================================

      if (contact.resident_id !== residentId) {
        console.error("Resident access mismatch:", {
          authorizedResident: contact.resident_id,
          requestedResident: residentId,
        });

        setError("You do not have permission to view this resident.");

        setLoading(false);
        return;
      }

      // ============================================================
      // 4. LOAD RESIDENT
      // ============================================================

      const { data: residentData, error: residentError } = await supabase
        .from("residents")
        .select("*")
        .eq("id", contact.resident_id)
        .single();

      console.log("RESIDENT:", residentData);
      console.log("RESIDENT ERROR:", residentError);

      if (residentError || !residentData) {
        setError(
          residentError?.message ||
            "Couldn't load resident details. Please check your access permissions.",
        );

        setLoading(false);
        return;
      }

      // ============================================================
      // 5. LOAD CARE LOGS FROM care_logs_demo
      // ============================================================

      const { data: careData, error: careError } = await supabase
        .from("care_logs_demo")
        .select(
          "id, resident_name, room, meals, fluids, mood, medication, notes, created_at, photo_url, systolic, diastolic, heart_rate, temperature, pain_scale, pain_note, resident_id, staff_id, entry_source, source_id",
        )
        .eq("resident_id", contact.resident_id)
        .order("created_at", { ascending: false })
        .limit(50);

      console.log("CARE LOGS:", careData);
      console.log("CARE LOG ERROR:", careError);

      // ============================================================
      // 6. LOAD INCIDENTS
      // ============================================================

      const { data: incidentData, error: incidentError } = await supabase
        .from("incidents")
        .select("*")
        .eq("resident_id", contact.resident_id)
        .order("created_at", { ascending: false })
        .limit(20);

      console.log("INCIDENTS:", incidentData);
      console.log("INCIDENT ERROR:", incidentError);

      // ============================================================
      // 7. LOAD EMERGENCY ALERTS
      // ============================================================

      const { data: alertData, error: alertError } = await supabase
        .from("emergency_alerts")
        .select("*")
        .eq("resident_id", contact.resident_id)
        .order("created_at", { ascending: false })
        .limit(20);

      console.log("ALERTS:", alertData);
      console.log("ALERT ERROR:", alertError);

      // ============================================================
      // 8. SAVE DATA
      // ============================================================

      setResident(residentData as Resident);

      setCareLogs((careData as CareLog[]) || []);

      setIncidents((incidentData as Incident[]) || []);

      setAlerts((alertData as EmergencyAlert[]) || []);

      setLoading(false);
    } catch (err) {
      console.error("FAMILY PORTAL ERROR:", err);

      setError("Something went wrong while loading the family portal.");

      setLoading(false);
    }
  }, [residentId, router]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ============================================================
  // LIVE CARE LOG UPDATES
  // Keep this family portal synchronized with the same
  // care_logs_demo rows written by the staff care-log page.
  // ============================================================

  useEffect(() => {
    if (!residentId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`family-care-logs-${residentId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "care_logs_demo",
          filter: `resident_id=eq.${residentId}`,
        },
        () => {
          loadAll();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [residentId, loadAll]);

  // ============================================================
  // SIGN OUT
  // ============================================================

  async function handleSignOut() {
    const supabase = createClient();

    await supabase.auth.signOut();

    router.push("/family-login");
  }

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-[#4F9C8B] border-t-transparent rounded-full animate-spin mx-auto mb-3" />

          <p className="text-gray-400 text-sm">Loading family portal...</p>
        </div>
      </div>
    );
  }

  // ============================================================
  // ERROR
  // ============================================================

  if (error || !resident) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] px-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-500 text-xl">!</span>
          </div>

          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            Unable to load portal
          </h1>

          <p className="text-sm text-gray-500 mb-6">
            {error || "Resident information could not be loaded."}
          </p>

          <button
            onClick={() => router.push("/family-login")}
            className="px-5 py-2.5 rounded-xl bg-[#357366] text-white text-sm font-semibold hover:bg-[#2d6258] transition"
          >
            Back to family login
          </button>
        </div>
      </div>
    );
  }

  // ============================================================
  // TODAY'S DATA
  // ============================================================

  const todayLogs = careLogs.filter(
    (log) => log.created_at >= startOfTodayISO(),
  );

  const latestVitals = careLogs.find(
    (log) =>
      log.systolic != null ||
      log.diastolic != null ||
      log.heart_rate != null ||
      log.temperature != null ||
      log.pain_scale != null,
  );

  const latestCareLog = careLogs[0] ?? null;

  const careSummary = buildCareSummary(careLogs, todayLogs.length);

  // ============================================================
  // TIMELINE
  // ============================================================

  const timeline: TimelineItem[] = [
    ...careLogs.map((e) => ({
      ...e,
      _type: "care_log" as const,
    })),

    ...incidents.map((e) => ({
      ...e,
      _type: "incident" as const,
    })),

    ...alerts.map((e) => ({
      ...e,
      _type: "emergency_alert" as const,
    })),
  ].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // ============================================================
  // PAGE
  // ============================================================

  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* ========================================================
          HEADER
      ======================================================== */}

      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#EAF4F1] flex items-center justify-center">
              <span className="text-[#357366] font-bold text-sm">EL</span>
            </div>

            <span className="font-bold text-gray-900">ElderLink</span>

            <span className="text-gray-300 mx-1">|</span>

            <span className="text-sm text-gray-500">Family</span>
          </div>

          <button
            onClick={handleSignOut}
            className="text-xs text-gray-500 hover:text-red-500 border border-gray-200 hover:border-red-200 px-3 py-1.5 rounded-lg transition-all"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* ========================================================
          MAIN
      ======================================================== */}

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-8">
        {/* ======================================================
            WELCOME
        ====================================================== */}

        {familyContact && (
          <div className="bg-[#EAF4F1] border border-[#D7EDE7] rounded-2xl px-5 py-4">
            <p className="text-xs text-[#357366] font-medium">Welcome back</p>

            <p className="text-sm font-semibold text-gray-900 mt-1">
              {familyContact.full_name}
              {familyContact.relationship
                ? ` · ${familyContact.relationship}`
                : ""}
            </p>
          </div>
        )}

        {/* ======================================================
            RESIDENT CARD
        ====================================================== */}

        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
          {resident.photo_url ? (
            <Image
              src={resident.photo_url}
              alt={resident.full_name}
              width={64}
              height={64}
              className="w-16 h-16 rounded-full object-cover border border-gray-100 flex-shrink-0"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[#EAF4F1] text-[#357366] font-bold text-xl flex items-center justify-center flex-shrink-0">
              {initials(resident.full_name)}
            </div>
          )}

          <div className="min-w-0">
            <h1 className="font-bold text-lg text-gray-900 truncate">
              {resident.full_name}
            </h1>

            <p className="text-sm text-gray-400">
              {resident.room_number
                ? `Room ${resident.room_number}`
                : "No room assigned"}

              {resident.dob &&
                ` · DOB ${new Date(resident.dob).toLocaleDateString()}`}
            </p>
          </div>
        </div>

        {/* ======================================================
            TODAY'S SUMMARY
        ====================================================== */}

        <section>
          <SectionTitle>Today&apos;s summary</SectionTitle>

          {todayLogs.length === 0 ? (
            <EmptyCard text="No care activity logged yet today." />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SummaryCard
                label="Meals"
                value={latestCareLog?.meals || "—"}
              />

              <SummaryCard
                label="Fluids"
                value={latestCareLog?.fluids || "—"}
              />

              <SummaryCard
                label="Mood"
                value={latestCareLog?.mood || "—"}
              />

              <SummaryCard
                label="Medication"
                value={latestCareLog?.medication || "—"}
              />
            </div>
          )}
        </section>

        {/* ======================================================
            CARE SUMMARY REPORT
            Calculated directly from the care_logs_demo rows shown
            above. Nothing here is hard-coded.
        ====================================================== */}

        <section>
          <div className="flex items-center justify-between gap-3 mb-3">
            <SectionTitle>Care summary report</SectionTitle>
            <span className="text-xs text-gray-400">
              Based on {careSummary.totalLogs} recent log
              {careSummary.totalLogs === 1 ? "" : "s"}
            </span>
          </div>

          {careSummary.totalLogs === 0 ? (
            <EmptyCard text="No care logs are available for this resident yet." />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard
                  label="Logs"
                  value={String(careSummary.totalLogs)}
                />
                <SummaryCard
                  label="Today"
                  value={String(careSummary.todayLogs)}
                />
                <SummaryCard
                  label="Notes"
                  value={String(careSummary.noteCount)}
                />
                <SummaryCard
                  label="Pain ≥ 6"
                  value={String(careSummary.painConcernCount)}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <ReportMetricCard
                  label="Avg Heart Rate"
                  value={
                    careSummary.avgHeartRate != null
                      ? `${careSummary.avgHeartRate.toFixed(1)} bpm`
                      : "—"
                  }
                />
                <ReportMetricCard
                  label="Avg Temperature"
                  value={
                    careSummary.avgTemperature != null
                      ? `${careSummary.avgTemperature.toFixed(1)} °F`
                      : "—"
                  }
                />
                <ReportMetricCard
                  label="Avg Pain"
                  value={
                    careSummary.avgPain != null
                      ? `${careSummary.avgPain.toFixed(1)} / 10`
                      : "—"
                  }
                />
                <ReportMetricCard
                  label="Avg BP"
                  value={
                    careSummary.avgSystolic != null ||
                    careSummary.avgDiastolic != null
                      ? `${careSummary.avgSystolic != null ? careSummary.avgSystolic.toFixed(0) : "—"}/${careSummary.avgDiastolic != null ? careSummary.avgDiastolic.toFixed(0) : "—"}`
                      : "—"
                  }
                />
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 p-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ReportTextRow
                    label="Log sources"
                    value={[
                      careSummary.manualCount
                        ? `Manual: ${careSummary.manualCount}`
                        : null,
                      careSummary.sensorCount
                        ? `Sensor: ${careSummary.sensorCount}`
                        : null,
                      careSummary.demoCount
                        ? `Demo: ${careSummary.demoCount}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  />

                  <ReportTextRow
                    label="Report period"
                    value={
                      careSummary.earliestAt && careSummary.latestAt
                        ? `${careSummary.earliestAt.toLocaleDateString("en-GB")} – ${careSummary.latestAt.toLocaleDateString("en-GB")}`
                        : "—"
                    }
                  />
                </div>

                {careSummary.latestNotes.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-xs font-semibold text-gray-400 mb-2">
                      Recent staff notes
                    </p>
                    <div className="space-y-2">
                      {careSummary.latestNotes.map((log) => (
                        <div
                          key={log.id}
                          className="rounded-xl bg-[#FAFAF8] border border-gray-100 p-3"
                        >
                          <p className="text-sm text-gray-700 whitespace-pre-wrap">
                            {log.notes}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-1">
                            {new Date(log.created_at).toLocaleString("en-GB", {
                              hour: "2-digit",
                              minute: "2-digit",
                              day: "2-digit",
                              month: "short",
                            })}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {latestCareLog && (
                <div className="bg-[#EAF4F1] border border-[#D7EDE7] rounded-2xl p-5">
                  <p className="text-xs font-semibold text-[#357366] mb-3">
                    Latest care log
                  </p>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <ReportMetricCard
                      label="Meals"
                      value={latestCareLog.meals || "—"}
                    />
                    <ReportMetricCard
                      label="Fluids"
                      value={latestCareLog.fluids || "—"}
                    />
                    <ReportMetricCard
                      label="Mood"
                      value={latestCareLog.mood || "—"}
                    />
                    <ReportMetricCard
                      label="Medication"
                      value={latestCareLog.medication || "—"}
                    />
                  </div>

                  {latestCareLog.notes && (
                    <div className="mt-3">
                      <ReportTextRow
                        label="Latest note"
                        value={latestCareLog.notes}
                      />
                    </div>
                  )}

                  <p className="text-[11px] text-gray-400 mt-3">
                    Source: {latestCareLog.entry_source || "unknown"} ·{" "}
                    {new Date(latestCareLog.created_at).toLocaleString("en-GB", {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "2-digit",
                      month: "short",
                    })}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ======================================================
            LATEST VITALS
        ====================================================== */}

        {latestVitals && (
          <section>
            <SectionTitle>Latest vitals</SectionTitle>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {latestVitals.systolic && latestVitals.diastolic && (
                <VitalCard
                  label="Blood Pressure"
                  value={`${latestVitals.systolic}/${latestVitals.diastolic}`}
                  unit="mmHg"
                />
              )}

              {latestVitals.heart_rate && (
                <VitalCard
                  label="Heart Rate"
                  value={latestVitals.heart_rate}
                  unit="bpm"
                />
              )}

              {latestVitals.temperature && (
                <VitalCard
                  label="Temperature"
                  value={latestVitals.temperature}
                  unit="°F"
                />
              )}

              {latestVitals.pain_scale != null && (
                <VitalCard
                  label="Pain Scale"
                  value={`${latestVitals.pain_scale}/10`}
                  unit={latestVitals.pain_note || ""}
                />
              )}
            </div>
          </section>
        )}

        {/* ======================================================
            RECENT MOMENTS
        ====================================================== */}

        <section>
          <SectionTitle>Recent moments</SectionTitle>

          <p className="text-sm text-gray-400 mb-3">
            Candid photos shared by staff will appear here.
          </p>

          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square rounded-xl bg-[#EAF4F1] flex items-center justify-center text-gray-300 text-2xl"
              >
                📷
              </div>
            ))}
          </div>
        </section>

        {/* ======================================================
            UPCOMING EVENTS
        ====================================================== */}

        <section>
          <SectionTitle>Upcoming events</SectionTitle>

          <EmptyCard text="No upcoming events scheduled yet." />
        </section>

        {/* ======================================================
            RECENT ACTIVITY
        ====================================================== */}

        <section>
          <SectionTitle>Recent activity</SectionTitle>

          <EventList events={timeline.slice(0, 10)} />
        </section>

        {/* ======================================================
            RESIDENT DETAILS
        ====================================================== */}

        <section>
          <SectionTitle>Resident details</SectionTitle>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
            <DetailRow label="Full Name" value={resident.full_name} />

            <DetailRow
              label="Date of Birth"
              value={
                resident.dob ? new Date(resident.dob).toLocaleDateString() : "—"
              }
            />

            <DetailRow
              label="Room Number"
              value={resident.room_number || "—"}
            />

            <DetailRow label="Address" value={resident.address || "—"} />

            <DetailRow
              label="Medical Notes"
              value={resident.medical_notes || "—"}
              multiline
            />
          </div>
        </section>
      </main>
    </div>
  );
}

// ================================================================
// COMPONENTS
// ================================================================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="font-semibold text-gray-900 mb-3">{children}</h2>;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>

      <p className="text-sm font-semibold text-gray-900 capitalize">{value}</p>
    </div>
  );
}

function VitalCard({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit: string;
}) {
  return (
    <div className="bg-[#EAF4F1] rounded-xl border border-[#D7EDE7] p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>

      <p className="text-lg font-bold text-[#357366]">
        {value}{" "}
        <span className="text-xs font-medium text-gray-400">{unit}</span>
      </p>
    </div>
  );
}

function ReportMetricCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-sm font-semibold text-gray-900 capitalize">{value}</p>
    </div>
  );
}

function ReportTextRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 mb-1">{label}</p>
      <p className="text-sm text-gray-900 whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 text-sm text-gray-400">
      {text}
    </div>
  );
}

function EventList({ events }: { events: TimelineItem[] }) {
  if (events.length === 0) {
    return <EmptyCard text="No activity yet." />;
  }

  return (
    <div className="space-y-2">
      {events.map((e) => {
        const meta = EVENT_META[e._type];

        return (
          <div
            key={`${e._type}-${e.id}`}
            className="bg-white rounded-xl border border-gray-100 p-4 flex gap-3"
          >
            <span
              className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${meta.dot}`}
            />

            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${meta.color}`}>
                {meta.label}
              </p>

              {"notes" in e && e.notes && (
                <p className="text-sm text-gray-600 mt-0.5">{e.notes}</p>
              )}

              {"meals" in e && (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span>Meals: {e.meals || "—"}</span>
                  <span>Fluids: {e.fluids || "—"}</span>
                  <span>Mood: {e.mood || "—"}</span>
                  <span>Medication: {e.medication || "—"}</span>
                </div>
              )}

              {"systolic" in e &&
                ("diastolic" in e || "heart_rate" in e || "temperature" in e) && (
                  <p className="text-xs text-gray-500 mt-2">
                    Vitals:{" "}
                    {e.systolic != null && e.diastolic != null
                      ? `BP ${e.systolic}/${e.diastolic} mmHg`
                      : e.systolic != null
                        ? `Systolic ${e.systolic}`
                        : ""}
                    {e.heart_rate != null
                      ? ` · HR ${e.heart_rate} bpm`
                      : ""}
                    {e.temperature != null
                      ? ` · Temp ${e.temperature} °F`
                      : ""}
                    {"pain_scale" in e && e.pain_scale != null
                      ? ` · Pain ${e.pain_scale}/10`
                      : ""}
                  </p>
                )}

              {"pain_note" in e && e.pain_note && (
                <p className="text-xs text-gray-500 mt-1">
                  Pain note: {e.pain_note}
                </p>
              )}

              {"entry_source" in e && e.entry_source && (
                <p className="text-[11px] text-gray-400 mt-1 capitalize">
                  Source: {e.entry_source}
                </p>
              )}

              {"description" in e && e.description && (
                <p className="text-sm text-gray-600 mt-0.5">{e.description}</p>
              )}

              {"type" in e && e.type && (
                <p className="text-sm text-gray-600 mt-0.5">Type: {e.type}</p>
              )}

              {"status" in e && e.status && (
                <p className="text-xs text-gray-400 mt-0.5 capitalize">
                  Status: {e.status}
                </p>
              )}

              <p className="text-xs text-gray-400 mt-1">
                {new Date(e.created_at).toLocaleString("en-GB", {
                  hour: "2-digit",
                  minute: "2-digit",
                  day: "2-digit",
                  month: "short",
                })}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({
  label,
  value,
  multiline,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 mb-1">{label}</p>

      <p
        className={`text-sm text-gray-900 ${
          multiline ? "whitespace-pre-wrap" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
