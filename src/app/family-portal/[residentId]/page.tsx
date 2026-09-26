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
  resident_id: string;
  staff_id: string | null;
  meals: string | null;
  fluids: string | null;
  mood: string | null;
  medication: string | null;
  notes: string | null;
  systolic: number | null;
  diastolic: number | null;
  heart_rate: number | null;
  temperature: number | null;
  pain_scale: number | null;
  pain_note: string | null;
  photo_url: string | null;
  created_at: string;
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
      // 5. LOAD CARE LOGS
      // ============================================================

      const { data: careData, error: careError } = await supabase
        .from("care_logs")
        .select("*")
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
      log.systolic ||
      log.diastolic ||
      log.heart_rate ||
      log.temperature ||
      log.pain_scale != null,
  );

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
              {todayLogs[0]?.meals && (
                <SummaryCard label="Meals" value={todayLogs[0].meals} />
              )}

              {todayLogs[0]?.fluids && (
                <SummaryCard label="Fluids" value={todayLogs[0].fluids} />
              )}

              {todayLogs[0]?.mood && (
                <SummaryCard label="Mood" value={todayLogs[0].mood} />
              )}

              {todayLogs[0]?.medication && (
                <SummaryCard
                  label="Medication"
                  value={todayLogs[0].medication}
                />
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
