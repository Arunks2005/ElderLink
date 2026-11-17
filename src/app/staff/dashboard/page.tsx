"use client";

/**
 * Staff dashboard: one screen for the shift.
 *
 *   ┌ live fall / SOS alerts ───────────────────────────────────────┐
 *   │ shift strip: shift · logged today · needs attention · SOS     │
 *   ├ left ───────────────────┬ main ───────────────────────────────┤
 *   │ Behaviour analysis      │ Ward board: beds with Log care,     │
 *   │ (live, care logs +      │ SOS, Help and Details on each bed   │
 *   │  sensors, 1-week normal)│                                     │
 *   │ Handoff notes           │                                     │
 *   └─────────────────────────┴─────────────────────────────────────┘
 *
 * Residents appear once (in their bed). Realtime care logs, sensor nights,
 * falls and SOS alerts update the board and re-run the analysis.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  HeartPulse,
  LogOut,
  User as UserIcon,
  ShieldAlert,
  Send,
  FileText,
  ClipboardList,
  Bot,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { createClient } from "../../../lib/supabase/client";
import SOSModal from "../../../components/SOSModal";
import ElderAIDock, { DOCK_WIDTH_CLASS } from "../../../components/ElderAIDock";
import HelpRequestModal from "../../../components/HelpRequestModal";
import HelpRequestsBar from "../../../components/HelpRequestsBar";
import EndOfShiftModal from "../../../components/EndOfShiftModal";
import LiveAlerts from "../../../components/LiveAlerts";
import HandoverModal from "../../../components/HandoverModal";
import BehaviourPanel from "../../../components/BehaviourPanel";
import WardBoard, { type BoardResident } from "../../../components/WardBoard";
import { shiftFor } from "../../../lib/handover/build";
import { loadWards, PENDING_BED_KEY, type Ward } from "../../../lib/wards/wards";
import type { FacilityReport } from "../../../lib/early-warning/engine";

type Resident = {
  id: string;
  full_name: string;
  room_number: string | null;
  photo_url: string | null;
  status: string;
};

type StaffUser = { id: string; email: string | undefined; full_name: string | null };

type HandoverNote = { id: string; note: string; shift: string | null; created_at: string };

type Status = "act" | "watch" | "stable" | "baseline";

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const SHIFT_HOURS: Record<string, string> = { Morning: "06:00–14:00", Evening: "14:00–22:00", Night: "22:00–06:00" };

// Same ElderAI chat route used on the admin dashboard.

export default function StaffDashboard() {
  const router = useRouter();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [loggedIds, setLoggedIds] = useState<Set<string>>(new Set());
  const [falls, setFalls] = useState<Set<string>>(new Set());
  const [sosCountToday, setSosCountToday] = useState(0);
  const [statuses, setStatuses] = useState<Map<string, Status>>(new Map());
  const [attentionCount, setAttentionCount] = useState<number | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [handoverNotes, setHandoverNotes] = useState<HandoverNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [postingNote, setPostingNote] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sosResident, setSosResident] = useState<BoardResident | null>(null);
  const [assistResident, setAssistResident] = useState<BoardResident | null>(null);
  const [showEndShift, setShowEndShift] = useState(false);
  const [showHandover, setShowHandover] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [user, setUser] = useState<StaffUser | null>(null);
  const [shift, setShift] = useState<string>("");

  const loadFalls = useCallback(async () => {
    const { data } = await createClient().from("fall_events").select("resident_id").in("status", ["unresolved", "active"]);
    setFalls(new Set((data ?? []).map((f) => f.resident_id as string).filter(Boolean)));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!u) {
        router.push("/login");
        return;
      }

      // A bed QR tag scanned before signing in: continue to that bed now.
      let pendingBed: string | null = null;
      try {
        pendingBed = localStorage.getItem(PENDING_BED_KEY);
        if (pendingBed) localStorage.removeItem(PENDING_BED_KEY);
      } catch {
        /* storage unavailable */
      }
      if (pendingBed) {
        router.push(`/b/${pendingBed}`);
        return;
      }

      const todayStart = startOfTodayISO();
      const [profile, residentRes, logRes, sosRes, notesRes, wardRes] = await Promise.all([
        supabase.from("staff").select("full_name").eq("id", u.id).maybeSingle(),
        supabase.from("residents").select("id, full_name, room_number, photo_url, status").eq("status", "active").order("full_name"),
        supabase.from("care_logs_demo").select("resident_id").gte("created_at", todayStart),
        supabase.from("emergency_alerts").select("id", { count: "exact", head: true }).gte("created_at", todayStart),
        supabase.from("handover_notes").select("id, note, shift, created_at").order("created_at", { ascending: false }).limit(3),
        loadWards(supabase),
      ]);
      if (cancelled) return;

      setUser({ id: u.id, email: u.email, full_name: (profile.data as { full_name: string | null } | null)?.full_name ?? null });
      setResidents((residentRes.data as Resident[]) ?? []);
      setLoggedIds(new Set((logRes.data ?? []).map((l) => l.resident_id as string)));
      setSosCountToday(sosRes.count ?? 0);
      setHandoverNotes((notesRes.data as HandoverNote[]) ?? []);
      setWards(wardRes.wards);
      setShift(shiftFor(new Date()).shift);
      await loadFalls();
      setLoading(false);

      // Live updates: new data re-runs the behaviour analysis.
      channel = supabase
        .channel("staff-dashboard")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "care_logs_demo" }, (p) => {
          const rid = (p.new as { resident_id?: string }).resident_id;
          if (rid) setLoggedIds((prev) => new Set(prev).add(rid));
          setDataVersion((v) => v + 1);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "daily_aggregates" }, () => setDataVersion((v) => v + 1))
        .on("postgres_changes", { event: "*", schema: "public", table: "fall_events" }, () => void loadFalls())
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "emergency_alerts" }, () => setSosCountToday((n) => n + 1))
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [router, loadFalls]);

  const onReport = useCallback((rep: FacilityReport) => {
    setStatuses(new Map(rep.residents.map((r) => [r.resident_id, r.status as Status])));
    setAttentionCount(rep.residents.filter((r) => r.status === "act" || r.status === "watch").length);
  }, []);

  async function refreshHandoverNotes() {
    const { data } = await createClient()
      .from("handover_notes")
      .select("id, note, shift, created_at")
      .order("created_at", { ascending: false })
      .limit(3);
    if (data) setHandoverNotes(data as HandoverNote[]);
  }

  async function handlePostNote() {
    if (!newNote.trim()) return;
    setPostingNote(true);
    const supabase = createClient();
    const author = user?.full_name || user?.email || null;
    const note = author ? `${newNote.trim()} (by ${author})` : newNote.trim();
    let { error } = await supabase.from("handover_notes").insert({ note, shift: shiftFor(new Date()).shift });
    if (error && /shift/i.test(error.message)) {
      ({ error } = await supabase.from("handover_notes").insert({ note }));
    }
    setPostingNote(false);
    if (!error) {
      setNewNote("");
      setActionError(null);
      await refreshHandoverNotes();
    } else {
      setActionError(`Could not post note: ${error.message}`);
    }
  }



  async function handleConfirmSignOut() {
    await createClient().auth.signOut();
    router.push("/login");
  }

  const placedIds = useMemo(() => new Set(wards.flatMap((w) => w.beds.map((b) => b.resident_id)).filter(Boolean)), [wards]);
  const unplaced = residents.filter((r) => !placedIds.has(r.id));
  const loggedCount = residents.filter((r) => loggedIds.has(r.id)).length;
  const displayName = user?.full_name || user?.email || "Staff";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F6F7F5]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#4F9C8B] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 font-medium text-sm tracking-wide">Preparing your shift workspace...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-[#F6F7F5] text-[#1F2937] font-sans transition-[padding] duration-300 ${aiOpen ? DOCK_WIDTH_CLASS : ""}`}>
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-white/90 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="p-2 rounded-xl bg-[#EAF4F1] text-[#4F9C8B] group-hover:scale-105 transition-transform duration-200">
              <HeartPulse className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight">
              Elder<span className="text-[#4F9C8B]">Link</span>
            </span>
          </Link>
          <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider text-[#357366] bg-[#EAF4F1] px-2.5 py-1 rounded-full border border-[#4F9C8B]/20">
            Staff
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowEndShift(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 px-3 py-2 rounded-xl"
            >
              <ClipboardList className="w-3.5 h-3.5 text-[#4F9C8B]" />
              <span className="hidden sm:inline">End of shift</span>
            </button>
            <div className="hidden sm:flex items-center gap-2 border-l border-gray-200 pl-3">
              <div className="w-8 h-8 rounded-full bg-[#EAF4F1] border border-[#4F9C8B]/30 flex items-center justify-center">
                <UserIcon className="w-4 h-4 text-[#357366]" />
              </div>
              <span className="text-xs font-medium text-gray-700 max-w-[130px] truncate">{displayName}</span>
            </div>
            <button
              onClick={() => setShowEndShift(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-red-600 bg-white hover:bg-red-50/50 border border-gray-200 px-3 py-2 rounded-xl"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        <LiveAlerts />
        <HelpRequestsBar />

        {/* Shift strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-[#357366] to-[#4F9C8B] text-white p-4">
            <div className="text-[11px] uppercase tracking-wider text-emerald-100 font-semibold flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> {shift || "Current"} shift
            </div>
            <div className="text-lg font-black mt-0.5">{SHIFT_HOURS[shift] ?? ""}</div>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Logged today</div>
            <div className="text-2xl font-black">
              {loggedCount}
              <span className="text-sm font-semibold text-gray-400">/{residents.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${residents.length ? (loggedCount / residents.length) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Needs attention</div>
            <div className={`text-2xl font-black flex items-center gap-1.5 ${attentionCount ? "text-amber-600" : "text-emerald-600"}`}>
              {attentionCount === null ? "…" : attentionCount}
              {attentionCount === 0 && <CheckCircle2 className="w-5 h-5" />}
              {!!attentionCount && <AlertTriangle className="w-5 h-5" />}
            </div>
          </div>
          <div className="rounded-2xl bg-white border border-gray-100 p-4">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">SOS today</div>
            <div className={`text-2xl font-black flex items-center gap-1.5 ${sosCountToday ? "text-red-600" : "text-gray-300"}`}>
              {sosCountToday}
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
        </div>

        {actionError && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{actionError}</p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          {/* Right column: compact behaviour analysis + handoff notes.
              On phones it comes after the ward, which is the round. */}
          <div className="space-y-4 lg:sticky lg:top-20 order-2">
            <BehaviourPanel dataVersion={dataVersion} onReport={onReport} />

            <section className="bg-white rounded-3xl border border-gray-100 shadow-xs p-4 space-y-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-[#EAF4F1] text-[#357366]">
                  <FileText className="w-4 h-4" />
                </div>
                <h2 className="font-bold">Handoff notes</h2>
                <button
                  onClick={() => setShowHandover(true)}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-white bg-[#357366] hover:bg-[#2b5e53] px-2.5 py-1.5 rounded-lg"
                >
                  <ClipboardList className="w-3.5 h-3.5" /> Generate
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Note for the next shift…"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 bg-[#FAFAF8] text-sm outline-none focus:bg-white focus:border-[#4F9C8B]"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handlePostNote();
                  }}
                  aria-label="Handoff note"
                />
                <button
                  onClick={handlePostNote}
                  disabled={postingNote || !newNote.trim()}
                  className="px-3 rounded-xl bg-[#357366] text-white disabled:opacity-40"
                  aria-label="Post note"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              {handoverNotes.length === 0 ? (
                <p className="text-xs text-gray-400">No handoff notes yet.</p>
              ) : (
                <ul className="space-y-2">
                  {handoverNotes.map((n) => (
                    <li key={n.id} className="rounded-xl bg-[#FAFAF8] border-l-4 border-[#4F9C8B] px-3 py-2 text-xs">
                      <p className="text-gray-800 whitespace-pre-wrap max-h-24 overflow-y-auto">{n.note}</p>
                      <p className="text-gray-400 mt-1">
                        {n.shift ? `${n.shift} · ` : ""}
                        {new Date(n.created_at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Main: the ward (wide, first) */}
          <div className="order-1 min-w-0">
          <WardBoard
            wards={wards}
            unplaced={unplaced}
            loggedToday={loggedIds}
            falls={falls}
            statuses={statuses}
            onSos={setSosResident}
            onAssist={setAssistResident}
            onDetails={(r) => router.push(`/staff/residents/${r.id}`)}
          />
          </div>
        </div>
      </main>

      {/* MODALS */}
      {sosResident && <SOSModal key={sosResident.id} resident={sosResident} isOpen onClose={() => setSosResident(null)} />}


      {assistResident && (
        <HelpRequestModal
          resident={assistResident}
          onClose={() => setAssistResident(null)}
          onSent={(e) => setActionError(e ? `Help request failed: ${e}` : null)}
        />
      )}

      {showEndShift && user && (
        <EndOfShiftModal
          staffId={user.id}
          staffName={displayName}
          totalResidents={residents.length}
          loggedCount={loggedCount}
          sosCountToday={sosCountToday}
          onClose={() => setShowEndShift(false)}
          onConfirmSignOut={handleConfirmSignOut}
          onGenerateHandover={() => {
            setShowEndShift(false);
            setShowHandover(true);
          }}
        />
      )}

      {showHandover && <HandoverModal onClose={() => setShowHandover(false)} onSaved={refreshHandoverNotes} />}

      {!aiOpen && <FloatingAIButton onClick={() => setAiOpen(true)} />}
      <ElderAIDock open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

// Fixed bottom-right ElderAI launcher (the only ElderAI entry point here).
function FloatingAIButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Ask ElderAI (new chat)"
      aria-label="Ask ElderAI"
      className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full flex items-center justify-center shadow-xl shadow-indigo-500/30 hover:scale-105 active:scale-95 transition-transform duration-200"
      style={{ background: "linear-gradient(135deg, #6366f1, #7c3aed)" }}
    >
      <span className="absolute inset-0 rounded-full bg-indigo-400/40 animate-ping" style={{ animationDuration: "2.4s" }} />
      <Bot className="w-6 h-6 text-white relative z-10" />
    </button>
  );
}
