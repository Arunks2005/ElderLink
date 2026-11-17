"use client";

/**
 * Resident details: everything about one resident on one page, with the
 * three actions staff need at the bedside (Log care, Help, SOS) and the
 * bed's QR tag. Scanning a bed tag opens this page.
 */

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  ClipboardPlus,
  Droplets,
  HeartPulse,
  HelpCircle,
  History,
  Loader2,
  Moon,
  Phone,
  Pill,
  Printer,
  ShieldAlert,
  Smile,
  Thermometer,
  Utensils,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import QrCode from "@/components/QrCode";
import SOSModal from "@/components/SOSModal";
import HelpRequestModal from "@/components/HelpRequestModal";
import { bedUrl } from "@/lib/wards/wards";
import { usePhoneOrigin } from "@/lib/wards/phone-origin";
import type { FacilityReport, ResidentReport } from "@/lib/early-warning/engine";
import { durationText, isStale, PRESENCE_LABEL, type Presence } from "@/lib/presence";

type Resident = {
  id: string;
  full_name: string;
  dob: string | null;
  room_number: string | null;
  photo_url: string | null;
  medical_notes: string | null;
  dietary_needs: string | null;
  status: string | null;
};
type Log = {
  id: string;
  created_at: string;
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
  entry_source: string | null;
};
type Contact = { id: string; full_name: string; relationship: string | null; phone: string | null; is_primary: boolean | null };
type Night = {
  date: string;
  sleep_hours: number | null;
  washroom_visits: number | null;
  night_bed_exits: number | null;
  night_breathing_rate: number | null;
  sensor_source: string | null;
};
type Bed = { label: string; qr_token: string; ward: { name: string } | null };
type Event = { id: string; at: string; kind: "fall" | "incident" | "sos"; text: string };

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  act: { label: "Act today", cls: "bg-red-50 text-red-700 border-red-200" },
  watch: { label: "Watch", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  stable: { label: "Usual pattern", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  baseline: { label: "Learning their normal", cls: "bg-slate-50 text-slate-600 border-slate-200" },
};

const OUTCOME_LABEL: Record<string, string> = {
  no_injury: "no injury",
  minor_injury: "minor injury",
  hospital: "sent to hospital",
  false_alarm: "false alarm",
};

function age(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob);
  const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function ResidentDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const origin = usePhoneOrigin();

  const [resident, setResident] = useState<Resident | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [nights, setNights] = useState<Night[]>([]);
  const [bed, setBed] = useState<Bed | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [report, setReport] = useState<ResidentReport | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showSos, setShowSos] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [presence, setPresence] = useState<Presence | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
      const [r, l, c, n, b, f, inc, sos, pres] = await Promise.all([
        supabase.from("residents").select("id, full_name, dob, room_number, photo_url, medical_notes, dietary_needs, status").eq("id", id).maybeSingle(),
        supabase
          .from("care_logs_demo")
          .select("id, created_at, meals, fluids, mood, medication, notes, systolic, diastolic, heart_rate, temperature, pain_scale, entry_source")
          .eq("resident_id", id)
          .order("created_at", { ascending: false })
          .limit(8),
        supabase.from("family_contacts").select("id, full_name, relationship, phone, is_primary").eq("resident_id", id).order("is_primary", { ascending: false }),
        supabase
          .from("daily_aggregates")
          .select("date, sleep_hours, washroom_visits, night_bed_exits, night_breathing_rate, sensor_source")
          .eq("resident_id", id)
          .not("sensor_source", "is", null)
          .order("date", { ascending: false })
          .limit(7),
        supabase.from("beds").select("label, qr_token, ward:wards(name)").eq("resident_id", id).maybeSingle(),
        supabase.from("fall_events").select("id, triggered_at, status, outcome").eq("resident_id", id).gte("triggered_at", since30).order("triggered_at", { ascending: false }).limit(5),
        supabase.from("incidents").select("id, created_at, description").eq("resident_id", id).gte("created_at", since30).order("created_at", { ascending: false }).limit(5),
        supabase.from("emergency_alerts").select("id, created_at, type").eq("resident_id", id).gte("created_at", since30).order("created_at", { ascending: false }).limit(5),
        supabase.from("resident_presence").select("resident_id, state, since, source, updated_at").eq("resident_id", id).maybeSingle(),
      ]);
      if (cancelled) return;
      if (r.error || !r.data) {
        setError(r.error?.message ?? "Resident not found, or your account can't see them.");
        return;
      }
      setResident(r.data as Resident);
      setPresence((pres.data as Presence | null) ?? null);
      setLogs((l.data ?? []) as Log[]);
      setContacts((c.data ?? []) as Contact[]);
      setNights((n.data ?? []) as Night[]);
      const bd = b.data as unknown as (Omit<Bed, "ward"> & { ward: Bed["ward"] | Bed["ward"][] }) | null;
      setBed(bd ? { ...bd, ward: Array.isArray(bd.ward) ? bd.ward[0] ?? null : bd.ward } : null);
      const ev: Event[] = [
        ...(f.data ?? []).map((x) => ({
          id: `f${x.id}`,
          at: x.triggered_at as string,
          kind: "fall" as const,
          text: `Fall detected${x.outcome ? ` – ${OUTCOME_LABEL[x.outcome] ?? x.outcome}` : x.status === "resolved" ? "" : " – still open"}`,
        })),
        ...(inc.data ?? []).map((x) => ({ id: `i${x.id}`, at: x.created_at as string, kind: "incident" as const, text: x.description ?? "Incident" })),
        ...(sos.data ?? []).map((x) => ({ id: `s${x.id}`, at: x.created_at as string, kind: "sos" as const, text: `SOS sent to family: ${x.type ?? "alert"}` })),
      ].sort((a, b2) => b2.at.localeCompare(a.at));
      setEvents(ev.slice(0, 8));

      // Behaviour vs their 1-week normal (same engine as the dashboard).
      try {
        const res = await fetch("/api/early-warning", { cache: "no-store" });
        const j = (await res.json()) as { report?: FacilityReport };
        if (!cancelled) setReport(j.report?.residents.find((x) => x.resident_id === id) ?? null);
      } catch {
        if (!cancelled) setReport(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const today = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return logs.filter((x) => new Date(x.created_at) >= start);
  }, [logs]);
  const vitals = logs.find((x) => x.systolic != null || x.heart_rate != null || x.temperature != null);
  const lastNight = nights[0];
  const qrValue = origin ? (bed ? bedUrl(origin, bed.qr_token) : `${origin}/staff/residents/${id}`) : "";

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F7F5] p-6">
        <div className="bg-white rounded-3xl border border-slate-100 p-6 max-w-sm text-center space-y-3">
          <p className="font-bold">Can&apos;t open this resident</p>
          <p className="text-sm text-slate-500">{error}</p>
          <Link href="/staff/dashboard" className="block bg-[#357366] text-white font-bold py-3 rounded-2xl">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }
  if (!resident) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F7F5]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const yrs = age(resident.dob);
  const st = report ? STATUS_STYLE[report.status] : null;

  return (
    <div className="min-h-screen bg-[#F6F7F5] text-slate-900 pb-28 print:bg-white print:pb-0">
      {/* Header */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-20 print:hidden">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/staff/dashboard" className="p-2 -ml-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <span className="font-bold">Resident details</span>
          <Link
            href={`/staff/residents/${id}/history`}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <History className="w-4 h-4" /> History
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4 print:hidden">
        {/* Identity */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#357366] to-[#2B5E53] text-white p-5 sm:p-6">
          <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-4">
            {resident.photo_url ? (
              <Image
                src={resident.photo_url}
                alt={resident.full_name}
                width={80}
                height={80}
                className="w-20 h-20 rounded-2xl object-cover border-2 border-white/30"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-white/15 flex items-center justify-center text-2xl font-black">
                {initials(resident.full_name)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-black leading-tight truncate">{resident.full_name}</h1>
              <p className="text-white/80 text-sm mt-0.5 flex flex-wrap items-center gap-x-2">
                <span className="inline-flex items-center gap-1">
                  <BedDouble className="w-4 h-4" /> {resident.room_number ?? "No bed assigned"}
                </span>
                {yrs != null && <span>· {yrs} yrs</span>}
                {resident.status && <span className="capitalize">· {resident.status}</span>}
                {presence && !isStale(presence) && (
                  <span>
                    · {PRESENCE_LABEL[presence.state].staff} {durationText(presence.since)}
                    {presence.source === "simulated" ? " (sim)" : ""}
                  </span>
                )}
              </p>
              {st && (
                <span className={`inline-block mt-2 text-xs font-bold px-2 py-0.5 rounded-md border ${st.cls}`}>{st.label}</span>
              )}
            </div>
          </div>
        </section>

        {/* Actions (desktop) */}
        <ActionButtons id={id} onHelp={() => setShowHelp(true)} onSos={() => setShowSos(true)} className="hidden sm:grid" />
        {toast && <p className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">{toast}</p>}

        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
          <div className="space-y-4">
            {/* Today */}
            <Card title="Today" icon={<ClipboardPlus className="w-4 h-4" />}>
              {today.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-900">Not logged yet today.</p>
                  <Link href={`/staff/residents/${id}/log`} className="text-sm font-bold text-[#357366] underline">
                    Log care now
                  </Link>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <Stat icon={<Utensils className="w-4 h-4" />} label="Meals" value={today[0].meals} />
                    <Stat icon={<Droplets className="w-4 h-4" />} label="Fluids" value={today[0].fluids} />
                    <Stat icon={<Smile className="w-4 h-4" />} label="Mood" value={today[0].mood} />
                    <Stat icon={<Pill className="w-4 h-4" />} label="Medication" value={today[0].medication} />
                  </div>
                  <p className="text-xs text-slate-500 mt-2">
                    {today.length} log{today.length === 1 ? "" : "s"} today · last at{" "}
                    {new Date(today[0].created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                </>
              )}
              {vitals && (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <Stat
                    icon={<HeartPulse className="w-4 h-4" />}
                    label="BP"
                    value={vitals.systolic != null ? `${vitals.systolic}/${vitals.diastolic ?? "—"}` : null}
                  />
                  <Stat icon={<Activity className="w-4 h-4" />} label="Pulse" value={vitals.heart_rate != null ? `${vitals.heart_rate} bpm` : null} />
                  <Stat icon={<Thermometer className="w-4 h-4" />} label="Temp" value={vitals.temperature != null ? `${vitals.temperature} °F` : null} />
                </div>
              )}
            </Card>

            {/* Behaviour */}
            <Card title="Compared with their usual week" icon={<Activity className="w-4 h-4" />}>
              {report === undefined ? (
                <p className="text-sm text-slate-500 inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Analysing…
                </p>
              ) : !report ? (
                <p className="text-sm text-slate-500">No analysis available yet.</p>
              ) : report.flaggedSignals.length === 0 && report.patterns.length === 0 ? (
                <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{report.summary}</p>
              ) : (
                <div className="space-y-2">
                  {report.topActions[0] && <p className="text-sm font-semibold text-[#357366]">→ {report.topActions[0]}</p>}
                  {report.patterns.map((p) => (
                    <div key={p.id} className="rounded-xl bg-slate-50 p-3">
                      <p className="font-semibold text-sm">{p.title}</p>
                      <ul className="list-disc pl-4 mt-1 text-xs text-slate-600 space-y-0.5">
                        {p.evidence.map((e) => (
                          <li key={e}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  {report.patterns.length === 0 && (
                    <ul className="list-disc pl-4 text-sm text-slate-700 space-y-0.5">
                      {report.flaggedSignals.map((s) => (
                        <li key={s.key}>{s.explanation}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-slate-400">Screening prompt, not a diagnosis.</p>
                </div>
              )}
            </Card>

            {/* Night */}
            {lastNight && (
              <Card
                title="Last night (bed + bathroom sensors)"
                icon={<Moon className="w-4 h-4" />}
                badge={lastNight.sensor_source === "simulated" ? "Simulated" : undefined}
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat label="Sleep" value={lastNight.sleep_hours != null ? `${Number(lastNight.sleep_hours).toFixed(1)} hours` : null} />
                  <Stat label="Bathroom trips" value={lastNight.washroom_visits} />
                  <Stat label="Out of bed" value={lastNight.night_bed_exits != null ? `${lastNight.night_bed_exits}×` : null} />
                  <Stat label="Breathing" value={lastNight.night_breathing_rate != null ? `${Number(lastNight.night_breathing_rate).toFixed(0)}/min` : null} />
                </div>
                {nights.length > 1 && (
                  <div className="mt-3 flex items-end gap-1 h-16" aria-label="Sleep hours, last 7 nights">
                    {[...nights].reverse().map((n2) => (
                      <div key={n2.date} className="flex-1 h-full flex flex-col items-center justify-end gap-0.5">
                        <div
                          className="w-full rounded-t bg-indigo-300"
                          style={{ height: `${Math.max(8, Math.min(80, ((Number(n2.sleep_hours) || 0) / 10) * 80))}%` }}
                          title={`${n2.date}: ${n2.sleep_hours ?? "—"} h`}
                        />
                        <span className="text-[9px] text-slate-400">{n2.date.slice(8)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Recent logs */}
            <Card title="Recent care logs" icon={<History className="w-4 h-4" />}>
              {logs.length === 0 ? (
                <p className="text-sm text-slate-500">No care logs yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {logs.slice(0, 5).map((x) => (
                    <li key={x.id} className="py-2 text-sm">
                      <p className="text-xs text-slate-400">
                        {when(x.created_at)}
                        {x.entry_source === "demo" ? " · demo" : ""}
                      </p>
                      <p className="text-slate-700">
                        {[x.meals && `Meals ${x.meals}`, x.fluids && `Fluids ${x.fluids}`, x.mood && `Mood ${x.mood}`].filter(Boolean).join(" · ") || "—"}
                      </p>
                      {x.notes && <p className="text-slate-500 text-xs mt-0.5">{x.notes}</p>}
                    </li>
                  ))}
                </ul>
              )}
              <Link href={`/staff/residents/${id}/history`} className="inline-block mt-2 text-sm font-semibold text-[#357366] hover:underline">
                Full history →
              </Link>
            </Card>
          </div>

          <div className="space-y-4">
            {/* Safety events */}
            <Card title="Falls & incidents (30 days)" icon={<AlertTriangle className="w-4 h-4" />}>
              {events.length === 0 ? (
                <p className="text-sm text-slate-500">None in the last 30 days.</p>
              ) : (
                <ul className="space-y-2">
                  {events.map((e) => (
                    <li key={e.id} className="flex gap-2 text-sm">
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${e.kind === "fall" ? "bg-red-500" : e.kind === "sos" ? "bg-rose-400" : "bg-amber-400"}`}
                      />
                      <span>
                        <span className="text-slate-800">{e.text}</span>
                        <span className="block text-[11px] text-slate-400">{when(e.at)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* Care notes */}
            <Card title="Care notes" icon={<ShieldAlert className="w-4 h-4" />}>
              <p className="text-xs font-semibold text-slate-400">Medical</p>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{resident.medical_notes || "—"}</p>
              <p className="text-xs font-semibold text-slate-400 mt-3">Diet</p>
              <p className="text-sm text-slate-800">{resident.dietary_needs || "—"}</p>
            </Card>

            {/* Family */}
            <Card title="Family" icon={<Phone className="w-4 h-4" />}>
              {contacts.length === 0 ? (
                <p className="text-sm text-slate-500">No family contact on file.</p>
              ) : (
                <ul className="space-y-2">
                  {contacts.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{c.full_name}</span>
                        {c.is_primary && <span className="ml-1 text-[10px] font-bold text-[#357366]">PRIMARY</span>}
                        <span className="block text-xs text-slate-500">{c.relationship ?? "Family"}</span>
                      </span>
                      {c.phone && (
                        <a href={`tel:${c.phone}`} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-700">
                          Call
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* QR */}
            <Card title={bed ? "Bed QR tag" : "Resident QR"} icon={<Printer className="w-4 h-4" />}>
              <div className="flex flex-col items-center text-center">
                {qrValue ? <QrCode value={qrValue} size={150} label={`QR code for ${resident.full_name}`} /> : <div className="h-[150px]" />}
                <p className="text-xs text-slate-500 mt-2">
                  {bed
                    ? `${bed.ward?.name ?? "Ward"} · ${bed.label}: scan to open this page. The tag stays with the bed.`
                    : "Scan to open this page."}
                </p>
                {qrValue && /^http:\/\/(192\.168|10|172)\./.test(qrValue) && (
                  <p className="text-[11px] text-amber-700 mt-1">Local test address: the phone must be on the same Wi-Fi.</p>
                )}
                <button
                  onClick={() => window.print()}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
                >
                  <Printer className="w-4 h-4" /> Print tag
                </button>
              </div>
            </Card>
          </div>
        </div>
      </main>

      {/* Printable tag only */}
      <div className="hidden print:flex flex-col items-center justify-center pt-10">
        <div className="border-2 border-black rounded-2xl p-5 text-center w-[260px]">
          <p className="text-xs font-bold uppercase tracking-wider">{bed?.ward?.name ?? "ElderLink"}</p>
          <p className="text-3xl font-black">{bed?.label ?? ""}</p>
          <p className="font-semibold mb-2">{resident.full_name}</p>
          {qrValue && <QrCode value={qrValue} size={190} label="Printable QR tag" />}
          <p className="text-[10px] mt-2">Scan with the phone camera · Log care · Help · SOS</p>
        </div>
      </div>

      {/* Actions (phone: fixed at the bottom, thumb-reachable) */}
      <div className="sm:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 p-3 print:hidden">
        <ActionButtons id={id} onHelp={() => setShowHelp(true)} onSos={() => setShowSos(true)} className="grid" />
      </div>

      {showSos && <SOSModal resident={resident} isOpen onClose={() => setShowSos(false)} />}
      {showHelp && (
        <HelpRequestModal
          resident={resident}
          onClose={() => setShowHelp(false)}
          onSent={(e) => {
            if (!e) {
              setToast("Help request sent. It's showing on every staff dashboard.");
              setTimeout(() => setToast(null), 5000);
            }
          }}
        />
      )}
    </div>
  );
}

function ActionButtons({ id, onHelp, onSos, className }: { id: string; onHelp: () => void; onSos: () => void; className: string }) {
  return (
    <div className={`${className} grid-cols-[2fr_1fr_1fr] gap-2`}>
      <Link
        href={`/staff/residents/${id}/log`}
        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#357366] hover:bg-[#2B5E53] text-white font-bold py-3.5"
      >
        <ClipboardPlus className="w-5 h-5" /> Log care
      </Link>
      <button onClick={onHelp} className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-bold py-3.5">
        <HelpCircle className="w-5 h-5" /> Help
      </button>
      <button onClick={onSos} className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black py-3.5">
        <AlertTriangle className="w-5 h-5" /> SOS
      </button>
    </div>
  );
}

function Card({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-3xl border border-slate-100 shadow-xs p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-bold text-slate-900 mb-3">
        <span className="p-1.5 rounded-lg bg-[#EAF4F1] text-[#357366]">{icon}</span>
        {title}
        {badge && <span className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">{badge}</span>}
      </h2>
      {children}
    </section>
  );
}

function Stat({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string | number | null | undefined }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2.5">
      <p className="flex items-center gap-1 text-[11px] font-semibold text-slate-500">
        {icon}
        {label}
      </p>
      <p className="text-sm font-bold text-slate-900 mt-0.5 first-letter:uppercase">{value === null || value === undefined || value === "" ? "—" : String(value)}</p>
    </div>
  );
}
