"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  HeartPulse,
  Search,
  LogOut,
  User as UserIcon,
  Clock,
  ShieldAlert,
  CheckCircle2,
  Send,
  Sparkles,
  FileText,
  HelpCircle,
  ClipboardList,
  AlertTriangle,
  ArrowRight,
  MessageSquare,
  Bot,
} from "lucide-react";
import { createClient } from "../../../lib/supabase/client";
import SOSModal from "../../../components/SOSModal";
import ResidentQuickView from "../../../components/ResidentQuickView";
import EndOfShiftModal from "../../../components/EndOfShiftModal";
import BehaviorAlertsSummaryCard from "../../../components/BehaviorAlertsSummaryCard";
import LiveAlerts from "../../../components/LiveAlerts";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
  photo_url: string | null;
  status: string;
};

type StaffUser = {
  id: string;
  email: string | undefined;
  full_name: string | null;
};

type HandoverNote = {
  id: string;
  note: string;
  shift: string | null;
  created_at: string;
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Same ElderAI chat route used on the admin dashboard, so staff and admins
// land in the same assistant. Always opened with ?new=1 so it starts a
// fresh conversation instead of resuming whatever was last open.
const BEHAVIORAL_AI_NEW_CHAT_PATH = "/admin/behavioral-trends?new=1";

export default function StaffDashboard() {
  const router = useRouter();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());
  const [sosCountToday, setSosCountToday] = useState(0);
  const [handoverNotes, setHandoverNotes] = useState<HandoverNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sosResident, setSosResident] = useState<Resident | null>(null);
  const [quickViewResident, setQuickViewResident] = useState<Resident | null>(
    null
  );
  const [assistResident, setAssistResident] = useState<Resident | null>(null);
  const [assistMessage, setAssistMessage] = useState("");
  const [sendingAssist, setSendingAssist] = useState(false);
  const [showEndShift, setShowEndShift] = useState(false);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!u) {
        router.push("/login");
        return;
      }

      const todayStart = startOfTodayISO();

      const profilePromise = supabase
        .from("profiles")
        .select("full_name")
        .eq("id", u.id)
        .single();

      const residentsPromise = supabase
        .from("residents")
        .select("id, full_name, room_number, photo_url, status")
        .eq("status", "active")
        .order("full_name");

      const careLogsPromise = supabase
        .from("care_logs")
        .select("resident_id")
        .gte("created_at", todayStart);

      const sosPromise = supabase
        .from("emergency_alerts")
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart);

      const handoverPromise = supabase
        .from("handover_notes")
        .select("id, note, shift, created_at")
        .order("created_at", { ascending: false })
        .limit(5);

      const [
        profileResult,
        { data: residentData, error: residentError },
        { data: logData },
        { count: sosCount },
        handoverResult,
      ] = await Promise.all([
        profilePromise.then(
          (r) => r,
          () => ({ data: null, error: true })
        ),
        residentsPromise,
        careLogsPromise,
        sosPromise,
        handoverPromise.then(
          (r) => r,
          () => ({ data: null, error: true })
        ),
      ]);

      setUser({
        id: u.id,
        email: u.email,
        full_name:
          profileResult && "data" in profileResult && profileResult.data
            ? (profileResult.data as { full_name: string | null }).full_name
            : null,
      });

      if (!residentError && residentData) setResidents(residentData);
      if (logData) {
        setLoggedIds(new Set(logData.map((l) => l.resident_id as string)));
      }
      setSosCountToday(sosCount ?? 0);
      if (handoverResult && "data" in handoverResult && handoverResult.data) {
        setHandoverNotes(handoverResult.data as HandoverNote[]);
      }

      setLoading(false);
    }
    load();
  }, [router]);

  async function refreshHandoverNotes() {
    const supabase = createClient();
    const { data } = await supabase
      .from("handover_notes")
      .select("id, note, shift, created_at")
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setHandoverNotes(data as HandoverNote[]);
  }

  async function handlePostNote() {
    if (!newNote.trim()) return;
    setPostingNote(true);
    const supabase = createClient();
    const { error } = await supabase.from("handover_notes").insert({
      note: newNote.trim(),
    });
    setPostingNote(false);
    if (!error) {
      setNewNote("");
      await refreshHandoverNotes();
    }
  }

  async function handleSendAssistance() {
    if (!assistResident) return;
    setSendingAssist(true);
    const supabase = createClient();
    await supabase.from("assistance_requests").insert({
      resident_id: assistResident.id,
      message: assistMessage.trim() || "Assistance requested",
      status: "open",
    });
    setSendingAssist(false);
    setAssistResident(null);
    setAssistMessage("");
  }

  async function handleSignOutRequest() {
    setShowEndShift(true);
  }

  async function handleConfirmSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const filtered = residents.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const pending = filtered.filter((r) => !loggedIds.has(r.id));
  const logged = filtered.filter((r) => loggedIds.has(r.id));

  const initials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  const displayName = user?.full_name || user?.email || "Staff";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] selection:bg-[#4F9C8B]/20">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#4F9C8B] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 font-medium text-sm tracking-wide">
            Preparing your shift workspace...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1F2937] selection:bg-[#4F9C8B]/20 selection:text-[#357366] relative overflow-hidden font-sans">
      {/* Background Ambient Glows */}
      <div className="absolute top-0 right-0 -z-10 w-[600px] h-[600px] bg-gradient-to-br from-[#4F9C8B]/10 via-[#EAF4F1]/30 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-[35%] -left-40 -z-10 w-[500px] h-[500px] bg-gradient-to-tr from-[#3B5C8A]/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#FAFAF8]/85 border-b border-gray-100/80 transition-all">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="p-2 rounded-xl bg-[#EAF4F1] text-[#4F9C8B] group-hover:scale-105 transition-transform duration-200">
                <HeartPulse className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg text-[#1F2937] tracking-tight">
                Elder<span className="text-[#4F9C8B]">Link</span>
              </span>
            </Link>
            <span className="text-gray-300">/</span>
            <span className="text-xs font-bold uppercase tracking-wider text-[#357366] bg-[#EAF4F1] px-2.5 py-1 rounded-full border border-[#4F9C8B]/20">
              Staff Portal
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(BEHAVIORAL_AI_NEW_CHAT_PATH)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 shadow-xs px-3.5 py-2 rounded-xl transition-all hidden sm:flex"
            >
              <Bot className="w-3.5 h-3.5" />
              <span>Ask ElderAI</span>
            </button>

            <button
              onClick={() => setShowEndShift(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 hover:text-[#357366] bg-white hover:bg-gray-50 border border-gray-200/80 shadow-xs px-3.5 py-2 rounded-xl transition-all hidden sm:flex"
            >
              <ClipboardList className="w-3.5 h-3.5 text-[#4F9C8B]" />
              <span>Shift Summary</span>
            </button>

            <div className="flex items-center gap-2 border-l border-gray-200/60 pl-3">
              <div className="w-8 h-8 rounded-full bg-[#EAF4F1] border border-[#4F9C8B]/30 flex items-center justify-center shrink-0">
                <UserIcon className="w-4 h-4 text-[#357366]" />
              </div>
              <span className="text-xs font-medium text-gray-700 hidden sm:block max-w-[130px] truncate">
                {displayName}
              </span>
            </div>

            <button
              onClick={handleSignOutRequest}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-red-600 bg-white hover:bg-red-50/50 border border-gray-200/80 hover:border-red-200/80 px-3 py-2 rounded-xl transition-all"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* LIVE EMERGENCY ALERTS
            Uses the shared LiveAlerts component from the teammate dashboard.
            It subscribes to the same Supabase emergency/fall alert stream, so
            this staff dashboard gets the same live feed without duplicating
            the emergency-system logic here. */}
        <LiveAlerts />

        {/* SHIFT SUMMARY HERO GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Main Shift Tracker */}
          <div className="sm:col-span-1 bg-gradient-to-br from-[#357366] via-[#3a7d6f] to-[#4F9C8B] rounded-2xl p-5 text-white shadow-md shadow-[#357366]/10 relative overflow-hidden flex flex-col justify-between">
            <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-white/10 rounded-full blur-xl pointer-events-none" />
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-emerald-100/90 text-xs font-semibold tracking-wider uppercase flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-200" /> Active
                  Shift
                </span>
                <span className="text-[10px] bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full font-mono">
                  {new Date().toLocaleDateString("en-US", { weekday: "short" })}
                </span>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight">
                {loggedIds.size} / {residents.length}{" "}
                <span className="text-sm font-normal text-emerald-100">
                  Logged
                </span>
              </h1>
            </div>

            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-emerald-100 mb-1 font-medium">
                <span>Progress</span>
                <span>
                  {residents.length
                    ? Math.round((loggedIds.size / residents.length) * 100)
                    : 0}
                  %
                </span>
              </div>
              <div className="w-full bg-black/20 backdrop-blur-xs rounded-full h-2 p-0.5 border border-white/10">
                <div
                  className="bg-white h-1.5 rounded-full transition-all duration-500 shadow-xs"
                  style={{
                    width: `${
                      residents.length
                        ? (loggedIds.size / residents.length) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          {/* Pending Logs Metric */}
          <div className="bg-white rounded-2xl border border-gray-100/80 p-5 shadow-xs flex flex-col justify-between hover:border-amber-200 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                Pending Logs
              </p>
              <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`text-3xl font-black tracking-tight ${
                  pending.length > 0 ? "text-amber-600" : "text-[#357366]"
                }`}
              >
                {pending.length}
              </span>
              <span className="text-xs text-gray-400 font-medium">
                {pending.length === 1 ? "resident left" : "residents left"}
              </span>
            </div>
          </div>

          {/* SOS Alert Metric */}
          <div className="bg-white rounded-2xl border border-gray-100/80 p-5 shadow-xs flex flex-col justify-between hover:border-red-200 transition-colors">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                SOS Alerts Today
              </p>
              <div
                className={`p-2 rounded-xl ${
                  sosCountToday > 0
                    ? "bg-red-50 text-red-600 animate-pulse"
                    : "bg-gray-50 text-gray-400"
                }`}
              >
                <ShieldAlert className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span
                className={`text-3xl font-black tracking-tight ${
                  sosCountToday > 0 ? "text-red-600" : "text-gray-300"
                }`}
              >
                {sosCountToday}
              </span>
              <span className="text-xs text-gray-400 font-medium">
                dispatched
              </span>
            </div>
          </div>
        </div>

        {/* SHIFT HANDOFF WHITEBOARD */}
        <div className="bg-white rounded-2xl border border-gray-200/70 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[#EAF4F1] text-[#357366]">
                <FileText className="w-4 h-4" />
              </div>
              <h2 className="font-bold text-[#1F2937] text-base tracking-tight">
                Shift Handoff Notes
              </h2>
            </div>
            <span className="text-xs text-gray-400 font-medium">
              Visible to next shift
            </span>
          </div>

          <div className="flex gap-2 mb-4">
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Leave a note for the incoming team..."
              className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200/80 bg-[#FAFAF8] text-sm outline-none focus:bg-white focus:border-[#4F9C8B] focus:ring-3 focus:ring-[#4F9C8B]/10 transition-all"
              onKeyDown={(e) => {
                if (e.key === "Enter") handlePostNote();
              }}
            />
            <button
              onClick={handlePostNote}
              disabled={postingNote || !newNote.trim()}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#357366] hover:bg-[#2b5e53] text-white text-sm font-semibold rounded-xl disabled:opacity-40 hover:shadow-md hover:shadow-[#357366]/20 transition-all active:scale-95 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{postingNote ? "Posting..." : "Post"}</span>
            </button>
          </div>

          {handoverNotes.length === 0 ? (
            <div className="text-center py-6 border border-dashed border-gray-200 rounded-xl bg-[#FAFAF8]">
              <p className="text-xs text-gray-400">
                No handoff notes recorded for today yet.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {handoverNotes.map((n) => (
                <div
                  key={n.id}
                  className="p-3 bg-[#FAFAF8] rounded-xl border-l-4 border-[#4F9C8B] border-y border-r border-gray-100/80 flex items-start justify-between gap-3 text-sm"
                >
                  <div className="space-y-1">
                    <p className="text-gray-800 font-medium leading-relaxed">
                      {n.note}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {n.shift && (
                        <span className="bg-emerald-50 text-[#357366] px-2 py-0.5 rounded-md font-semibold text-[10px]">
                          {n.shift}
                        </span>
                      )}
                      <span>
                        {new Date(n.created_at).toLocaleString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* BEHAVIOR PATTERN ALERTS SUMMARY */}
        <BehaviorAlertsSummaryCard />

        {/* SEARCH BAR */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search active residents by name..."
            className="w-full pl-11 pr-4 py-3 rounded-2xl border border-gray-200/80 bg-white text-sm outline-none focus:border-[#4F9C8B] focus:ring-4 focus:ring-[#4F9C8B]/10 shadow-xs transition-all placeholder:text-gray-400"
          />
        </div>

        {/* RESIDENTS GRID & SECTIONS */}
        {filtered.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100 shadow-xs">
            <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 mx-auto mb-3">
              <Search className="w-6 h-6" />
            </div>
            <p className="text-gray-600 font-semibold text-sm">
              No residents found
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {search
                ? `No active resident matches "${search}".`
                : "No active residents registered in the system."}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* PENDING SECTION */}
            {pending.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                    </span>
                    <h2 className="font-bold text-gray-900 text-base tracking-tight">
                      Needs Care Logging
                    </h2>
                    <span className="bg-amber-100 text-amber-800 text-xs font-bold px-2.5 py-0.5 rounded-full">
                      {pending.length}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">Shift Action Required</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pending.map((r) => (
                    <ResidentCard
                      key={r.id}
                      resident={r}
                      initials={initials(r.full_name)}
                      pending
                      onSos={() => setSosResident(r)}
                      onQuickView={() => setQuickViewResident(r)}
                      onAssist={() => setAssistResident(r)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* LOGGED SECTION */}
            {logged.length > 0 && (
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-200/60 pb-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#4F9C8B]" />
                    <h2 className="font-bold text-gray-700 text-base tracking-tight">
                      Completed Logs
                    </h2>
                    <span className="bg-emerald-100 text-[#357366] text-xs font-bold px-2.5 py-0.5 rounded-full">
                      {logged.length}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">Updated Today</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {logged.map((r) => (
                    <ResidentCard
                      key={r.id}
                      resident={r}
                      initials={initials(r.full_name)}
                      pending={false}
                      onSos={() => setSosResident(r)}
                      onQuickView={() => setQuickViewResident(r)}
                      onAssist={() => setAssistResident(r)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {/* MODALS */}
      {sosResident && (
        <SOSModal
          key={sosResident.id}
          resident={sosResident}
          isOpen={!!sosResident}
          onClose={() => setSosResident(null)}
        />
      )}

      {quickViewResident && (
        <ResidentQuickView
          resident={quickViewResident}
          onClose={() => setQuickViewResident(null)}
        />
      )}

      {/* Request Assistance Modal */}
      {assistResident && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2.5 rounded-xl bg-amber-50 text-amber-600">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-extrabold text-gray-900 text-lg">
                  Request Assistance
                </h3>
                <p className="text-xs text-gray-400">
                  For {assistResident.full_name}
                </p>
              </div>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed mb-4">
              Pings nearby floor staff or supervisor for extra assistance. This is
              for non-emergency operational support.
            </p>

            <textarea
              value={assistMessage}
              onChange={(e) => setAssistMessage(e.target.value)}
              placeholder="e.g., Need assistance with a two-person transfer"
              rows={3}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm outline-none focus:border-[#4F9C8B] focus:ring-3 focus:ring-[#4F9C8B]/10 transition-all mb-5 bg-[#FAFAF8]"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setAssistResident(null)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 active:scale-95 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSendAssistance}
                disabled={sendingAssist}
                className="flex-1 py-3 rounded-xl bg-[#357366] hover:bg-[#2b5e53] text-white text-sm font-semibold disabled:opacity-40 shadow-md shadow-[#357366]/20 active:scale-95 transition-all"
              >
                {sendingAssist ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showEndShift && user && (
        <EndOfShiftModal
          staffId={user.id}
          staffName={displayName}
          totalResidents={residents.length}
          loggedCount={loggedIds.size}
          sosCountToday={sosCountToday}
          onClose={() => setShowEndShift(false)}
          onConfirmSignOut={handleConfirmSignOut}
        />
      )}

      {/* Floating ElderAI launcher — reachable from every tab/section,
          mirrors the same button on the admin dashboard. */}
      <FloatingAIButton onClick={() => router.push(BEHAVIORAL_AI_NEW_CHAT_PATH)} />
    </div>
  );
}

// Fixed bottom-right AI assistant launcher. Kept visually distinct
// (indigo/violet) from the teal staff-portal palette on purpose, so it
// reads as the same ElderAI brand wherever it appears in the app.
function FloatingAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Ask ElderAI — starts a new chat"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-xl shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-transform duration-200"
      style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
    >
      <span
        className="absolute inset-0 rounded-full bg-indigo-400/40 animate-ping"
        style={{ animationDuration: "2.4s" }}
      />
      <Bot className="w-6 h-6 text-white relative z-10" />
    </button>
  );
}

function ResidentCard({
  resident: r,
  initials,
  pending,
  onSos,
  onQuickView,
  onAssist,
}: {
  resident: Resident;
  initials: string;
  pending: boolean;
  onSos: () => void;
  onQuickView: () => void;
  onAssist: () => void;
}) {
  return (
    <div
      className={`group bg-white rounded-2xl border shadow-xs p-5 flex flex-col justify-between gap-4 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 relative ${
        pending
          ? "border-amber-200/80 hover:border-amber-300"
          : "border-gray-200/70 hover:border-[#4F9C8B]/40"
      }`}
    >
      {/* Resident Info Row */}
      <div className="flex items-start gap-3.5">
        <div className="relative shrink-0">
          {r.photo_url ? (
            <Image
              src={r.photo_url}
              alt={r.full_name}
              width={56}
              height={56}
              className="w-14 h-14 rounded-2xl object-cover border border-gray-100 shadow-xs group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-[#EAF4F1] text-[#357366] font-extrabold text-lg flex items-center justify-center border border-[#4F9C8B]/20 shadow-xs group-hover:scale-105 transition-transform duration-300">
              {initials}
            </div>
          )}
          {pending ? (
            <span
              className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 border-2 border-white rounded-full"
              title="Pending Care Log"
            />
          ) : (
            <span
              className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-2 border-white rounded-full flex items-center justify-center text-white"
              title="Log Complete"
            >
              <CheckCircle2 className="w-2.5 h-2.5" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <button
              onClick={onQuickView}
              className="font-bold text-gray-900 truncate text-left hover:text-[#357366] hover:underline underline-offset-2 transition-colors text-base"
            >
              {r.full_name}
            </button>
          </div>

          <p className="text-xs font-semibold text-gray-400 flex items-center gap-1">
            <span>{r.room_number ? `Room ${r.room_number}` : "Unassigned"}</span>
          </p>

          <div className="mt-2">
            {pending ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-md">
                <Clock className="w-3 h-3 text-amber-600" /> PENDING LOG
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" /> LOGGED TODAY
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100/80">
        <Link
          href={`/staff/residents/${r.id}/log`}
          className="w-full inline-flex items-center justify-center gap-2 bg-[#4F9C8B] hover:bg-[#357366] text-white font-semibold py-2.5 rounded-xl text-sm transition-all shadow-xs hover:shadow-md hover:shadow-[#4F9C8B]/20 active:scale-98"
        >
          <span>Log Care</span>
          <ArrowRight className="w-4 h-4" />
        </Link>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onAssist}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-50 hover:bg-gray-100 text-gray-700 font-semibold py-2 rounded-xl text-xs transition-all active:scale-95 border border-gray-200/60"
          >
            <HelpCircle className="w-3.5 h-3.5 text-gray-500" />
            <span>Request Help</span>
          </button>
          <button
            onClick={onSos}
            className="w-full inline-flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-xl text-xs transition-all shadow-xs active:scale-95"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>SOS Alert</span>
          </button>
        </div>
      </div>
    </div>
  );
}