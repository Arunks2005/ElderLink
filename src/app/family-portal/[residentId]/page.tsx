"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import FamilyChatWidget from "@/components/FamilyChatWidget";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  CalendarDays,
  Camera,
  ClipboardCheck,
  Clock,
  Coffee,
  Droplets,
  Heart,
  HeartHandshake,
  HeartPulse,
  LogOut,
  MessageCircleHeart,
  Pill,
  ShieldCheck,
  Siren,
  Smile,
  Sun,
  UserRound,
  Utensils,
} from "lucide-react";

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
      if (authError || !user) {
        router.push("/family-login");
        return;
      }
      // ============================================================
      // 2. FIND FAMILY CONTACT
      // ============================================================

      const { data: contactRows, error: familyError } = await supabase
        .from("family_contacts")
        .select("id, resident_id, profile_id, full_name, relationship, email")
        .eq("profile_id", user.id);

      // A family member may be linked to more than one resident. Prefer the
      // link for the resident in the URL; otherwise fall back to the first.
      const contact =
        (contactRows ?? []).find((c) => c.resident_id === residentId) ??
        (contactRows ?? [])[0] ??
        null;
      if (familyError) {
        console.error("Family contact query failed:", familyError.message);

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
      // ============================================================
      // 6. LOAD INCIDENTS
      // ============================================================

      const { data: incidentData, error: incidentError } = await supabase
        .from("incidents")
        .select("*")
        .eq("resident_id", contact.resident_id)
        .order("created_at", { ascending: false })
        .limit(20);
      // ============================================================
      // 7. LOAD EMERGENCY ALERTS
      // ============================================================

      const { data: alertData, error: alertError } = await supabase
        .from("emergency_alerts")
        .select("*")
        .eq("resident_id", contact.resident_id)
        .order("created_at", { ascending: false })
        .limit(20);
      // Log only the error messages (never the records themselves).
      for (const [label, err] of [
        ["care logs", careError],
        ["incidents", incidentError],
        ["emergency alerts", alertError],
      ] as const) {
        if (err) console.error(`Family portal: could not load ${label}:`, err.message);
      }

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
    // Defer one tick so the load isn't a synchronous setState in the effect.
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
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

  const todayLogs = careLogs.filter((log) => log.created_at >= startOfTodayISO());
  const latestToday = todayLogs[0] ?? null;
  const latestVitals = careLogs.find(
    (log) => log.systolic != null || log.heart_rate != null || log.temperature != null || log.pain_scale != null,
  );
  const careSummary = buildCareSummary(careLogs, todayLogs.length);
  const firstName = (resident.full_name || "your relative").trim().split(/\s+/)[0];
  const familyFirst = familyContact?.full_name?.trim().split(/\s+/)[0] ?? "";
  const photos = careLogs.filter((l) => l.photo_url).slice(0, 8);

  const todayTone = latestToday
    ? [latestToday.meals, latestToday.fluids, latestToday.mood, latestToday.medication].map(toneOf)
    : [];
  const headline = !latestToday
    ? { text: `No update for ${firstName} yet today`, sub: "Staff usually log after meals and medicines.", tone: "neutral" as const }
    : todayTone.includes("bad")
      ? { text: `Staff noted something to keep an eye on today`, sub: "The care team is aware. Details are below.", tone: "bad" as const }
      : todayTone.includes("mid")
        ? { text: `${firstName} had an okay day so far`, sub: "A few things were a little below usual.", tone: "mid" as const }
        : { text: `${firstName} is doing well today`, sub: "Eating, drinking and medicines are on track.", tone: "good" as const };

  // Care visits per day, last 7 days (from the logs loaded above).
  const week = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    const next = new Date(d);
    next.setDate(d.getDate() + 1);
    const count = careLogs.filter((l) => {
      const t = new Date(l.created_at);
      return t >= d && t < next;
    }).length;
    return { label: d.toLocaleDateString("en-GB", { weekday: "short" }).slice(0, 2), count, isToday: i === 6 };
  });
  const maxWeek = Math.max(1, ...week.map((w) => w.count));

  const timeline: TimelineItem[] = [
    ...careLogs.map((e) => ({ ...e, _type: "care_log" as const })),
    ...incidents.map((e) => ({ ...e, _type: "incident" as const })),
    ...alerts.map((e) => ({ ...e, _type: "emergency_alert" as const })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const lastUpdate = careSummary.latestAt;

  return (
    <div className="min-h-screen bg-[#F7F5F0] text-gray-900">
      {/* HEADER */}
      <header className="bg-white/90 backdrop-blur border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-[#EAF4F1] flex items-center justify-center">
              <HeartHandshake className="w-5 h-5 text-[#357366]" />
            </div>
            <div className="leading-tight">
              <p className="font-bold text-gray-900">
                Elder<span className="text-[#4F9C8B]">Link</span>
              </p>
              <p className="text-[11px] text-gray-500">Family portal</p>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-red-600 border border-gray-200 hover:border-red-200 px-3 py-2 rounded-xl transition-all"
          >
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 pb-16">
        {/* HERO */}
        <section className="relative mt-5 rounded-[28px] overflow-hidden min-h-[260px] sm:min-h-[300px] shadow-xl shadow-[#357366]/10">
          <Image
            src={HERO_IMG}
            alt="A carer holding an older person's hand"
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#1E3D36]/95 via-[#1E3D36]/75 to-[#1E3D36]/20" />
          <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-end gap-5 h-full min-h-[260px] sm:min-h-[300px] justify-end">
            <div className="flex items-center gap-4">
              {resident.photo_url ? (
                <Image
                  src={resident.photo_url}
                  alt={resident.full_name}
                  width={88}
                  height={88}
                  className="w-[88px] h-[88px] rounded-3xl object-cover border-4 border-white/80 shadow-lg"
                />
              ) : (
                <div className="w-[88px] h-[88px] rounded-3xl bg-white/90 text-[#357366] font-black text-3xl flex items-center justify-center shadow-lg">
                  {initials(resident.full_name)}
                </div>
              )}
              <div className="text-white min-w-0">
                <p className="text-sm text-white/80">
                  {familyFirst ? `Hello ${familyFirst}` : "Welcome back"}
                  {familyContact?.relationship ? ` · ${familyContact.relationship}` : ""}
                </p>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight leading-tight truncate">{resident.full_name}</h1>
                <p className="mt-1 text-sm text-white/85 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <BedDouble className="w-4 h-4" /> {resident.room_number || "Bed not assigned"}
                  </span>
                  {lastUpdate && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-4 h-4" /> Last update {relativeTime(lastUpdate)}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="sm:ml-auto">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 border border-white/25 backdrop-blur px-3 py-1.5 text-xs font-semibold text-white">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                Live updates from the care team
              </span>
            </div>
          </div>
        </section>

        {/* TODAY HEADLINE + TILES */}
        <section className="mt-6">
          <div
            className={`rounded-3xl border p-5 flex items-start gap-4 ${
              headline.tone === "good"
                ? "bg-emerald-50 border-emerald-200"
                : headline.tone === "mid"
                  ? "bg-amber-50 border-amber-200"
                  : headline.tone === "bad"
                    ? "bg-rose-50 border-rose-200"
                    : "bg-white border-gray-200"
            }`}
          >
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                headline.tone === "good"
                  ? "bg-emerald-500 text-white"
                  : headline.tone === "mid"
                    ? "bg-amber-500 text-white"
                    : headline.tone === "bad"
                      ? "bg-rose-500 text-white"
                      : "bg-gray-100 text-gray-500"
              }`}
            >
              {headline.tone === "good" ? <Sun className="w-6 h-6" /> : headline.tone === "neutral" ? <Coffee className="w-6 h-6" /> : <Heart className="w-6 h-6" />}
            </div>
            <div>
              <p className="text-lg font-extrabold text-gray-900">{headline.text}</p>
              <p className="text-sm text-gray-600">{headline.sub}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <TodayTile icon={<Utensils className="w-5 h-5" />} label="Meals" value={latestToday?.meals ?? null} friendly={FRIENDLY.meals} />
            <TodayTile icon={<Droplets className="w-5 h-5" />} label="Drinking" value={latestToday?.fluids ?? null} friendly={FRIENDLY.fluids} />
            <TodayTile icon={<Smile className="w-5 h-5" />} label="Mood" value={latestToday?.mood ?? null} friendly={FRIENDLY.mood} />
            <TodayTile icon={<Pill className="w-5 h-5" />} label="Medicines" value={latestToday?.medication ?? null} friendly={FRIENDLY.medication} />
          </div>
        </section>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 mt-6 items-start">
          <div className="space-y-6">
            {/* VITALS */}
            <Panel
              title="Latest health checks"
              icon={<HeartPulse className="w-4 h-4" />}
              aside={latestVitals ? `Checked ${relativeTime(new Date(latestVitals.created_at))}` : undefined}
            >
              {!latestVitals ? (
                <EmptyCard text="No health checks recorded yet." />
              ) : (
                <div className="grid sm:grid-cols-[1fr_200px] gap-4 items-stretch">
                  <div className="grid grid-cols-2 gap-3">
                    <VitalCard
                      label="Blood pressure"
                      value={latestVitals.systolic != null ? `${latestVitals.systolic}/${latestVitals.diastolic ?? "—"}` : "—"}
                      unit="mmHg"
                      hint="Usual: around 120/80"
                    />
                    <VitalCard label="Heart rate" value={latestVitals.heart_rate ?? "—"} unit="bpm" hint="Usual: 60–100" />
                    <VitalCard label="Temperature" value={latestVitals.temperature ?? "—"} unit="°F" hint="Usual: 97–99 °F" />
                    <VitalCard
                      label="Pain"
                      value={latestVitals.pain_scale != null ? `${latestVitals.pain_scale}/10` : "—"}
                      unit=""
                      hint={latestVitals.pain_note || "0 means no pain"}
                    />
                  </div>
                  <div className="relative hidden sm:block rounded-2xl overflow-hidden min-h-[180px]">
                    <Image src={CARE_IMG} alt="A nurse checking a resident's blood pressure" fill sizes="200px" className="object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <p className="absolute bottom-3 left-3 right-3 text-xs font-semibold text-white">
                      Checked by trained staff at {resident.room_number?.split(" · ")[0] ?? "the home"}
                    </p>
                  </div>
                </div>
              )}
            </Panel>

            {/* WEEK */}
            <Panel title="Care visits this week" icon={<CalendarDays className="w-4 h-4" />} aside={`${careSummary.totalLogs} recent updates`}>
              <div className="flex items-end gap-2 h-32">
                {week.map((w) => (
                  <div key={w.label + w.isToday} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                    <span className="text-[11px] font-bold text-gray-500">{w.count || ""}</span>
                    <div
                      className={`w-full rounded-xl ${w.isToday ? "bg-[#357366]" : w.count ? "bg-[#9CCFC2]" : "bg-gray-100"}`}
                      style={{ height: `${Math.max(8, (w.count / maxWeek) * 80)}%` }}
                    />
                    <span className={`text-[11px] ${w.isToday ? "font-bold text-[#357366]" : "text-gray-400"}`}>{w.isToday ? "Today" : w.label}</span>
                  </div>
                ))}
              </div>
              {careSummary.latestNotes.length > 0 && (
                <div className="mt-5 space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Notes from the care team</p>
                  {careSummary.latestNotes.map((log) => (
                    <blockquote key={log.id} className="rounded-2xl bg-[#F7F5F0] border-l-4 border-[#4F9C8B] px-4 py-3">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{log.notes}</p>
                      <p className="text-[11px] text-gray-400 mt-1">{formatWhen(log.created_at)}</p>
                    </blockquote>
                  ))}
                </div>
              )}
            </Panel>

            {/* MOMENTS */}
            <Panel title="Moments" icon={<Camera className="w-4 h-4" />}>
              {photos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {photos.map((p) => (
                    <div key={p.id} className="relative aspect-square rounded-2xl overflow-hidden bg-gray-100">
                      <Image src={p.photo_url!} alt={`Photo shared on ${formatWhen(p.created_at)}`} fill sizes="200px" className="object-cover" />
                      <span className="absolute bottom-1.5 left-1.5 rounded-lg bg-black/50 px-1.5 py-0.5 text-[10px] text-white">{formatWhen(p.created_at)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="relative rounded-2xl overflow-hidden min-h-[160px] flex items-end">
                  <Image src={CONNECT_IMG} alt="" fill sizes="(max-width: 1024px) 100vw, 640px" className="object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#1E3D36]/90 via-[#1E3D36]/40 to-transparent" />
                  <p className="relative p-4 text-sm text-white">
                    <span className="font-bold block text-base">Photos will appear here</span>
                    When staff add a photo to {firstName}&apos;s care log, you&apos;ll see it here first.
                  </p>
                </div>
              )}
            </Panel>

            {/* TIMELINE */}
            <Panel title="Recent activity" icon={<Activity className="w-4 h-4" />}>
              <EventList events={timeline.slice(0, 10)} />
            </Panel>
          </div>

          {/* SIDE */}
          <aside className="space-y-6 lg:sticky lg:top-20">
            <Panel title={`About ${firstName}`} icon={<UserRound className="w-4 h-4" />}>
              <div className="space-y-3">
                <DetailRow label="Full name" value={resident.full_name} />
                <DetailRow label="Date of birth" value={resident.dob ? new Date(resident.dob).toLocaleDateString("en-GB") : "—"} />
                <DetailRow label="Ward / bed" value={resident.room_number || "—"} />
                <DetailRow label="Medical notes" value={resident.medical_notes || "—"} multiline />
              </div>
            </Panel>

            <div className="rounded-3xl bg-gradient-to-br from-[#357366] to-[#2B5E53] text-white p-5 shadow-lg shadow-[#357366]/20">
              <MessageCircleHeart className="w-7 h-7 text-emerald-200" />
              <p className="mt-2 font-bold text-lg">Questions about {firstName}?</p>
              <p className="text-sm text-white/80 mt-1">
                Ask the ElderLink assistant (bottom right) about meals, mood or recent care. It answers from {firstName}&apos;s
                records only.
              </p>
              <p className="text-xs text-white/60 mt-3">For anything urgent, please phone the home directly.</p>
            </div>

            <div className="rounded-3xl bg-white border border-gray-100 p-5">
              <p className="flex items-center gap-2 font-semibold text-gray-900">
                <ShieldCheck className="w-4 h-4 text-[#357366]" /> Your privacy
              </p>
              <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
                Only family members linked by the home can see this page, and only for {firstName}. You&apos;ll get an SMS or
                WhatsApp message straight away if there&apos;s an emergency.
              </p>
            </div>
          </aside>
        </div>
      </main>

      {/* Resident-scoped assistant; access is re-checked on the server. */}
      <FamilyChatWidget residentId={residentId} residentFirstName={firstName} />
    </div>
  );
}

// ================================================================
// COMPONENTS
// ================================================================

const HERO_IMG = "https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?auto=format&fit=crop&w=1600&q=80";
const CARE_IMG = "https://images.unsplash.com/photo-1542884748-2b87b36c6b90?auto=format&fit=crop&w=600&q=80";
const CONNECT_IMG = "https://images.unsplash.com/photo-1544027993-37dbfe43562a?auto=format&fit=crop&w=1200&q=80";

type Tone = "good" | "mid" | "bad" | "none";

const TONE_OF: Record<string, Tone> = {
  "ate fully": "good",
  good: "good",
  happy: "good",
  calm: "good",
  given: "good",
  partially: "mid",
  low: "mid",
  refused: "bad",
  none: "bad",
  agitated: "bad",
  confused: "bad",
  missed: "bad",
};

function toneOf(v: string | null | undefined): Tone {
  if (!v) return "none";
  return TONE_OF[v.trim().toLowerCase()] ?? "mid";
}

const FRIENDLY: Record<"meals" | "fluids" | "mood" | "medication", Record<string, string>> = {
  meals: { "ate fully": "Ate well", partially: "Ate some", refused: "Didn't eat" },
  fluids: { good: "Drinking well", low: "Drinking less", none: "Not drinking" },
  mood: { happy: "Happy", calm: "Calm", agitated: "Unsettled", confused: "A little confused" },
  medication: { given: "Taken", refused: "Refused", missed: "Missed" },
};

const TONE_STYLE: Record<Tone, { card: string; icon: string; dot: string }> = {
  good: { card: "bg-white border-emerald-100", icon: "bg-emerald-50 text-emerald-600", dot: "bg-emerald-500" },
  mid: { card: "bg-white border-amber-100", icon: "bg-amber-50 text-amber-600", dot: "bg-amber-500" },
  bad: { card: "bg-white border-rose-200", icon: "bg-rose-50 text-rose-600", dot: "bg-rose-500" },
  none: { card: "bg-white border-gray-100", icon: "bg-gray-50 text-gray-400", dot: "bg-gray-300" },
};

function TodayTile({
  icon,
  label,
  value,
  friendly,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  friendly: Record<string, string>;
}) {
  const tone = toneOf(value);
  const s = TONE_STYLE[tone];
  return (
    <div className={`rounded-3xl border p-4 ${s.card}`}>
      <div className="flex items-center justify-between">
        <span className={`w-10 h-10 rounded-2xl flex items-center justify-center ${s.icon}`}>{icon}</span>
        <span className={`w-2.5 h-2.5 rounded-full ${s.dot}`} />
      </div>
      <p className="text-xs font-semibold text-gray-500 mt-3">{label}</p>
      <p className="text-base font-extrabold text-gray-900">{value ? friendly[value.trim().toLowerCase()] ?? value : "Not logged yet"}</p>
    </div>
  );
}

function Panel({ title, icon, aside, children }: { title: string; icon: React.ReactNode; aside?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-3xl border border-gray-100 shadow-sm shadow-gray-200/40 p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-xl bg-[#EAF4F1] text-[#357366] flex items-center justify-center">{icon}</span>
        <h2 className="font-bold text-gray-900">{title}</h2>
        {aside && <span className="ml-auto text-xs text-gray-400">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function VitalCard({ label, value, unit, hint }: { label: string; value: string | number; unit: string; hint: string }) {
  return (
    <div className="rounded-2xl bg-[#F7F5F0] p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className="text-2xl font-black text-[#2B5E53] mt-0.5">
        {value} <span className="text-xs font-semibold text-gray-400">{unit}</span>
      </p>
      <p className="text-[11px] text-gray-400 mt-0.5 truncate">{hint}</p>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-2xl bg-[#F7F5F0] p-5 text-sm text-gray-500">{text}</div>;
}

function relativeTime(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

const EVENT_ICON: Record<TimelineItem["_type"], React.ReactNode> = {
  care_log: <ClipboardCheck className="w-4 h-4" />,
  incident: <AlertTriangle className="w-4 h-4" />,
  emergency_alert: <Siren className="w-4 h-4" />,
};

function EventList({ events }: { events: TimelineItem[] }) {
  if (events.length === 0) return <EmptyCard text="No activity yet." />;
  return (
    <ol className="relative space-y-4 before:absolute before:left-4 before:top-2 before:bottom-2 before:w-px before:bg-gray-200">
      {events.map((e) => {
        const meta = EVENT_META[e._type];
        const summary =
          e._type === "care_log"
            ? [
                e.meals && `Meals: ${FRIENDLY.meals[e.meals.toLowerCase()] ?? e.meals}`,
                e.fluids && `Drinking: ${FRIENDLY.fluids[e.fluids.toLowerCase()] ?? e.fluids}`,
                e.mood && `Mood: ${FRIENDLY.mood[e.mood.toLowerCase()] ?? e.mood}`,
                e.medication && `Medicines: ${FRIENDLY.medication[e.medication.toLowerCase()] ?? e.medication}`,
              ]
                .filter(Boolean)
                .join(" · ")
            : e._type === "incident"
              ? e.description
              : `${e.type ?? "Emergency"} alert${e.status ? ` · ${e.status}` : ""}`;
        return (
          <li key={`${e._type}-${e.id}`} className="relative flex gap-3 pl-0">
            <span className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-white border-2 ${meta.color} border-current`}>
              {EVENT_ICON[e._type]}
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-sm font-bold ${meta.color}`}>{meta.label}</span>
                <span className="text-[11px] text-gray-400">{formatWhen(e.created_at)}</span>
                {e._type === "care_log" && e.entry_source === "demo" && (
                  <span className="text-[10px] font-semibold text-gray-400 uppercase">demo</span>
                )}
              </p>
              {summary && <p className="text-sm text-gray-600 mt-0.5">{summary}</p>}
              {e._type === "care_log" && e.notes && <p className="text-sm text-gray-500 mt-0.5 italic">“{e.notes}”</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function DetailRow({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-sm text-gray-900 ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</p>
    </div>
  );
}
