"use client";

/**
 * Live fall alerts with a step-by-step response, shown at the top of the
 * staff and admin dashboards.
 *
 *   1. Alert   – appears instantly on every open dashboard with a repeating
 *                alarm tone. Anyone can tap "I'm going".
 *   2. Escalate – nobody responded in 2 min: marked "escalated" (supervisor /
 *                admin dashboard); 5 min: "all staff".
 *   3. Respond – at the resident: quick red-flag check. Any red flag means
 *                don't lift, call 108. Otherwise help up safely and check vitals.
 *   4. Tell family – one tap sends the SMS / WhatsApp alert.
 *   5. Close   – record the outcome. A fall incident is saved to the
 *                resident's record (family portal and handover see it).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellOff, BellRing, CheckCircle2, Footprints, Loader2, Phone, Send, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Resident = { id: string; full_name: string; room_number: string | null };

type FallEvent = {
  id: number | string;
  resident_id: string | null;
  device_id: string | null;
  status: string | null;
  triggered_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_by_name: string | null;
  escalation_level: number | null;
  family_notified_at: string | null;
};

type Alert = FallEvent & { resident: Resident | null };

const COLS =
  "id, resident_id, device_id, status, triggered_at, acknowledged_at, acknowledged_by, acknowledged_by_name, escalation_level, family_notified_at";
const OPEN = ["unresolved", "active", "acknowledged"];
const ESCALATE_1_S = 120;
const ESCALATE_2_S = 300;
/** Only alerts from the last day count as "active"; older ones are stale. */
const ACTIVE_WINDOW_MS = 24 * 3600 * 1000;

const RED_FLAGS = [
  { key: "unresponsive", label: "Not responding, or not breathing normally" },
  { key: "head", label: "Hit their head, or is bleeding" },
  { key: "pain", label: "Severe pain, can't move a limb, or hip/leg looks wrong" },
  { key: "confused", label: "New confusion, slurred speech or a drooping face" },
] as const;
type FlagKey = (typeof RED_FLAGS)[number]["key"];

const OUTCOMES = [
  { value: "no_injury", label: "No injury – helped up, vitals checked" },
  { value: "minor_injury", label: "Minor injury – treated here" },
  { value: "hospital", label: "Sent to hospital / doctor called" },
  { value: "false_alarm", label: "False alarm – no fall" },
] as const;

function since(iso: string | null, now: number) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
}

function mmss(s: number) {
  if (s >= 86400) return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** "SIM-RADAR60-BATH-WARDA" -> "Ward A bathroom"; falls back to the bed. */
function placeOf(a: Alert) {
  const d = (a.device_id ?? "").toUpperCase();
  const ward = a.resident?.room_number?.split(" · ")[0];
  const m = d.match(/BATH-WARD([A-Z0-9]+)/);
  if (m) return `Ward ${m[1]} bathroom`;
  if (d.includes("BATH")) return `${ward ?? "Ward"} bathroom`;
  if (d.includes("PHONE") || !d) return a.resident?.room_number ?? "Phone fall detection";
  return a.resident?.room_number ?? d;
}

export default function LiveAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState("Connecting");
  const [now, setNow] = useState(() => Date.now());
  const [muted, setMuted] = useState(false);
  const me = useRef<{ id: string; name: string; role: "staff" | "admin" | null } | null>(null);

  // ── data ──────────────────────────────────────────────────────────────
  const attach = useCallback(async (events: FallEvent[]): Promise<Alert[]> => {
    const supabase = createClient();
    const ids = Array.from(new Set(events.map((e) => e.resident_id).filter((x): x is string => Boolean(x))));
    const map = new Map<string, Resident>();
    if (ids.length) {
      const { data } = await supabase.from("residents").select("id, full_name, room_number").in("id", ids);
      for (const r of data ?? []) map.set(r.id, r as Resident);
    }
    return events.map((e) => ({ ...e, resident: e.resident_id ? map.get(e.resident_id) ?? null : null }));
  }, []);

  const alertsRef = useRef<Alert[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Pop-up on every other screen when someone taps "I'm going". */
  const noticeResponders = useCallback((next: Alert[]) => {
    for (const a of next) {
      if (a.status !== "acknowledged" || !a.acknowledged_by || a.acknowledged_by === me.current?.id) continue;
      const before = alertsRef.current.find((x) => String(x.id) === String(a.id));
      if (before && before.status !== "acknowledged") {
        setToast(`${a.acknowledged_by_name ?? "A colleague"} is going to ${a.resident?.full_name ?? "the fall"} (${placeOf(a)})`);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(null), 10000);
      }
    }
  }, []);

  const refreshOne = useCallback(
    async (id: FallEvent["id"]) => {
      const supabase = createClient();
      const { data } = await supabase.from("fall_events").select(COLS).eq("id", id).maybeSingle();
      const stale = data?.triggered_at ? Date.now() - new Date(data.triggered_at).getTime() > ACTIVE_WINDOW_MS : false;
      if (!data || stale || !OPEN.includes(String(data.status))) {
        setAlerts((cur) => cur.filter((a) => String(a.id) !== String(id)));
        return;
      }
      const [full] = await attach([data as FallEvent]);
      noticeResponders([full]);
      setAlerts((cur) => {
        const exists = cur.some((a) => String(a.id) === String(id));
        return exists ? cur.map((a) => (String(a.id) === String(id) ? full : a)) : [full, ...cur];
      });
    },
    [attach, noticeResponders]
  );

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Full reload of open alerts. Also runs every 15 s as a backup, because
    // phone networks often drop the live connection silently.
    const loadOpen = async () => {
      const { data, error } = await supabase
        .from("fall_events")
        .select(COLS)
        .in("status", OPEN)
        .gte("triggered_at", new Date(Date.now() - ACTIVE_WINDOW_MS).toISOString())
        .order("triggered_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("Failed to load fall alerts:", error.message);
        return;
      }
      const next = await attach((data ?? []) as FallEvent[]);
      if (cancelled) return;
      noticeResponders(next);
      setAlerts(next);
      setLoading(false);
    };
    const poll = setInterval(() => void loadOpen(), 15000);

    void (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const [s, ad] = await Promise.all([
          supabase.from("staff").select("full_name").eq("id", u.user.id).maybeSingle(),
          supabase.from("admins").select("full_name").eq("id", u.user.id).maybeSingle(),
        ]);
        me.current = {
          id: u.user.id,
          name: s.data?.full_name || ad.data?.full_name || u.user.email?.split("@")[0] || "Staff",
          role: ad.data ? "admin" : s.data ? "staff" : null,
        };
      }
      await loadOpen();
      setLoading(false);
    })();

    const channel = supabase
      .channel("elderlink-live-emergency")
      .on("postgres_changes", { event: "*", schema: "public", table: "fall_events" }, (payload) => {
        const id = (payload.new as { id?: FallEvent["id"] })?.id ?? (payload.old as { id?: FallEvent["id"] })?.id;
        if (id != null) void refreshOne(id);
      })
      .subscribe((status) => {
        setConnection(
          status === "SUBSCRIBED" ? "Connected" : status === "CHANNEL_ERROR" ? "Connection error" : status === "TIMED_OUT" ? "Timed out" : "Connecting"
        );
      });

    return () => {
      cancelled = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [attach, refreshOne, noticeResponders]);

  // ── clock, escalation, alarm tone ────────────────────────────────────
  const waiting = useMemo(() => alerts.filter((a) => a.status !== "acknowledged"), [alerts]);

  // Every second: tick the timers and escalate alerts nobody answered.
  useEffect(() => {
    alertsRef.current = alerts;
  }, [alerts]);

  useEffect(() => {
    if (alerts.length === 0) return;
    const supabase = createClient();
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      for (const a of alertsRef.current) {
        if (a.status === "acknowledged") continue;
        const age = since(a.triggered_at, t);
        const level = a.escalation_level ?? 0;
        const target = age >= ESCALATE_2_S ? 2 : age >= ESCALATE_1_S ? 1 : 0;
        if (target <= level) continue;
        setAlerts((cur) => cur.map((x) => (x.id === a.id ? { ...x, escalation_level: target } : x)));
        // Conditional update so several open dashboards escalate only once.
        // (Supabase queries are lazy: they only run once awaited / then-ed.)
        supabase
          .from("fall_events")
          .update({ escalation_level: target, escalated_at: new Date(t).toISOString() })
          .eq("id", a.id)
          .lt("escalation_level", target)
          .in("status", ["unresolved", "active"])
          .then(({ error }) => {
            if (error) console.error("Fall escalation not saved:", error.message);
          });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [alerts.length]);

  const audio = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (muted || waiting.length === 0) return;
    const beep = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audio.current = audio.current ?? new Ctx();
        const ctx = audio.current;
        void ctx.resume();
        [0, 0.35, 0.7].forEach((t) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
          g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.25);
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + t);
          o.stop(ctx.currentTime + t + 0.3);
        });
      } catch {
        /* audio blocked until the page is tapped */
      }
    };
    beep();
    const id = setInterval(beep, 10000);
    return () => clearInterval(id);
  }, [muted, waiting.length]);

  // ── render ───────────────────────────────────────────────────────────
  if (!loading && alerts.length === 0) {
    return (
      <section className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
        </span>
        <span className="font-semibold text-slate-800">No active emergencies</span>
        <span className="text-xs text-slate-500">Fall alerts appear here instantly with an alarm tone · {connection}</span>
      </section>
    );
  }
  if (loading) return null;

  return (
    <section className="w-full space-y-3" aria-live="assertive">
      {toast && (
        <div className="flex items-center gap-2 rounded-2xl bg-amber-500 text-white px-4 py-3 font-bold shadow-lg" role="status">
          <Footprints className="w-5 h-5 shrink-0" />
          <span className="flex-1">{toast}</span>
          <button onClick={() => setToast(null)} className="text-white/80 text-sm underline">
            OK
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-black text-red-700">
          <ShieldAlert className="w-4 h-4" /> {alerts.length} active fall alert{alerts.length === 1 ? "" : "s"}
        </span>
        <span className="text-xs text-slate-500">· {connection}</span>
        <button
          onClick={() => setMuted((m) => !m)}
          className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600"
        >
          {muted ? <BellOff className="w-3.5 h-3.5" /> : <BellRing className="w-3.5 h-3.5" />}
          {muted ? "Alarm muted" : "Mute alarm"}
        </button>
      </div>
      {alerts.map((a) => (
        <FallCard key={String(a.id)} alert={a} now={now} me={me} onChanged={() => void refreshOne(a.id)} />
      ))}
    </section>
  );
}

function FallCard({
  alert: a,
  now,
  me,
  onChanged,
}: {
  alert: Alert;
  now: number;
  me: React.RefObject<{ id: string; name: string; role: "staff" | "admin" | null } | null>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>({ unresponsive: false, head: false, pain: false, confused: false });
  const [outcome, setOutcome] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [familyMsg, setFamilyMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const acknowledged = a.status === "acknowledged";
  // The responder sees the full checklist; everyone else a one-line card.
  const mine = !!me.current && a.acknowledged_by === me.current.id;
  const showSteps = mine || expanded;
  const age = since(a.triggered_at, now);
  const level = a.escalation_level ?? 0;
  const responseS = a.acknowledged_at && a.triggered_at ? since(a.triggered_at, new Date(a.acknowledged_at).getTime()) : null;
  const anyRed = Object.values(flags).some(Boolean);
  const name = a.resident?.full_name ?? "Unknown person";
  const place = placeOf(a);

  async function acknowledge() {
    setBusy("ack");
    setError(null);
    const supabase = createClient();
    const { data: claimed, error: e } = await supabase
      .from("fall_events")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: me.current?.id ?? null,
        acknowledged_by_name: me.current?.name ?? "Staff",
      })
      .eq("id", a.id)
      .in("status", ["unresolved", "active"])
      .select("id");
    setBusy(null);
    if (e) setError(e.message);
    // Nothing updated: a colleague tapped first. The card refresh shows who.
    else if (!claimed || claimed.length === 0) setError("A colleague tapped “I'm going” first. You can still help or take over below.");
    onChanged();
  }

  async function notifyFamily() {
    if (!a.resident_id) return;
    setBusy("family");
    setFamilyMsg(null);
    try {
      const res = await fetch("/api/emergency-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: a.resident_id, alertType: "fall", channels: ["sms", "whatsapp"] }),
      });
      const j = await res.json().catch(() => ({}));
      const sent: string[] = j.sentChannels ?? [];
      const fails: { reason?: string }[] = j.failures ?? [];
      if (sent.length) {
        await createClient().from("fall_events").update({ family_notified_at: new Date().toISOString() }).eq("id", a.id);
        setFamilyMsg(`Family notified by ${sent.join(" + ")}.`);
        onChanged();
      } else {
        setFamilyMsg(j.error ?? fails[0]?.reason ?? "Could not reach the family. Please phone them.");
      }
    } catch {
      setFamilyMsg("Could not reach the family. Please phone them.");
    } finally {
      setBusy(null);
    }
  }

  async function close() {
    if (!outcome) {
      setError("Choose what happened before closing.");
      return;
    }
    setBusy("close");
    setError(null);
    const supabase = createClient();
    const flagged = RED_FLAGS.filter((f) => flags[f.key]).map((f) => f.label.toLowerCase());
    const { error: e } = await supabase
      .from("fall_events")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolved_by: me.current?.id ?? null,
        resolved_by_name: me.current?.name ?? "Staff",
        outcome,
        outcome_notes: notes.trim() || null,
        assessment: flags,
      })
      .eq("id", a.id);
    if (e) {
      setBusy(null);
      setError(e.message);
      return;
    }
    if (a.resident_id && outcome !== "false_alarm") {
      const label = OUTCOMES.find((o) => o.value === outcome)?.label ?? outcome;
      await supabase.from("incidents").insert({
        resident_id: a.resident_id,
        staff_id: me.current?.role === "staff" ? me.current.id : null,
        description:
          `Fall in ${place}. ${label}.` +
          (flagged.length ? ` Red flags: ${flagged.join("; ")}.` : " No red flags.") +
          (responseS != null ? ` Staff reached them in ${mmss(responseS)}.` : "") +
          (notes.trim() ? ` Notes: ${notes.trim()}` : "") +
          (outcome !== "no_injury" || flagged.length ? " Watch closely for 24 h." : ""),
      });
    }
    setBusy(null);
    onChanged();
  }

  return (
    <div className={`overflow-hidden rounded-2xl border-2 bg-white shadow-sm ${acknowledged ? "border-amber-300" : "border-red-500"}`}>
      {/* Header */}
      <div className={`flex flex-wrap items-center gap-3 px-4 py-3 ${acknowledged ? "bg-amber-50" : "bg-red-600 text-white"}`}>
        <span className={`flex h-10 w-10 items-center justify-center rounded-full ${acknowledged ? "bg-amber-500 text-white" : "bg-white text-red-600 animate-pulse"}`}>
          <Footprints className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-black text-lg leading-tight">
            Fall: {name}
          </p>
          <p className={`text-sm ${acknowledged ? "text-amber-800" : "text-red-50"}`}>
            {place} · detected {mmss(age)} ago
          </p>
        </div>
        {acknowledged ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 text-white px-3 py-1.5 text-sm font-black">
              <Footprints className="w-4 h-4" />
              {mine ? "You are on the way" : `${a.acknowledged_by_name ?? "A colleague"} is on the way`}
              <span className="font-semibold text-white/85">
                {a.acknowledged_at ? `· ${mmss(since(a.acknowledged_at, now))} ago` : ""}
              </span>
            </span>
            {responseS != null && <span className="text-xs text-amber-800">responded in {mmss(responseS)}</span>}
            {!mine && (
              <button onClick={() => setExpanded((x) => !x)} className="text-xs font-semibold text-amber-900 underline">
                {expanded ? "Hide steps" : "Help / take over"}
              </button>
            )}
          </span>
        ) : (
          <button
            onClick={acknowledge}
            disabled={busy === "ack"}
            className="rounded-xl bg-white text-red-700 font-black px-5 py-3 text-base shadow hover:bg-red-50 disabled:opacity-60"
          >
            {busy === "ack" ? "…" : "I'm going"}
          </button>
        )}
      </div>

      {!acknowledged && level > 0 && (
        <p className="flex items-center gap-2 bg-red-50 border-b border-red-200 px-4 py-2 text-sm font-semibold text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {level >= 2
            ? `No response for ${Math.floor(age / 60)} min: escalated to ALL staff and the admin. Anyone nearby, go now.`
            : "No response for 2 min: escalated to the supervisor / admin dashboard."}
        </p>
      )}

      {!acknowledged ? (
        <div className="px-4 py-3 text-sm text-slate-700 grid sm:grid-cols-3 gap-2">
          <Step n={1} active text="Tap “I'm going” so others know you're on it." />
          <Step n={2} text="At the resident: don't lift yet. Do the quick check." />
          <Step n={3} text="Tell family, record what happened, close." />
        </div>
      ) : !showSteps ? null : (
        <div className="p-4 space-y-4">
          {/* Red-flag check */}
          <div>
            <p className="text-sm font-bold text-slate-900 mb-2">Quick check before moving them: tick anything that applies</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {RED_FLAGS.map((f) => (
                <label
                  key={f.key}
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm cursor-pointer ${
                    flags[f.key] ? "border-red-400 bg-red-50 text-red-900 font-semibold" : "border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-red-600"
                    checked={flags[f.key]}
                    onChange={(e) => setFlags((s) => ({ ...s, [f.key]: e.target.checked }))}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          {anyRed ? (
            <div className="rounded-xl bg-red-600 text-white p-3 text-sm space-y-2">
              <p className="font-black text-base">Red flag: do NOT lift them</p>
              <p>Call an ambulance, keep them still and warm, stay with them, and inform the nurse in charge and the doctor.</p>
              <a href="tel:108" className="inline-flex items-center gap-2 bg-white text-red-700 font-black px-4 py-2 rounded-lg">
                <Phone className="w-4 h-4" /> Call 108 ambulance
              </a>
            </div>
          ) : (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900">
              <p className="font-bold">No red flags</p>
              <p>
                Help them up slowly with two staff (or a sturdy chair), check pulse, BP and pain, then settle them. Watch them
                closely for the next 24 hours.
              </p>
            </div>
          )}

          {/* Family */}
          <div className="flex flex-wrap items-center gap-2">
            {a.resident_id ? (
              a.family_notified_at ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
                  <CheckCircle2 className="w-4 h-4" /> Family notified
                </span>
              ) : (
                <button
                  onClick={notifyFamily}
                  disabled={busy === "family"}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold disabled:opacity-60"
                >
                  {busy === "family" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Tell the family (SMS / WhatsApp)
                </button>
              )
            ) : (
              <span className="text-sm text-slate-500">Radar could not identify the person: note who it was below.</span>
            )}
            {a.resident_id && (
              <Link href={`/staff/residents/${a.resident_id}`} className="text-sm font-semibold text-[#357366] underline">
                Resident details
              </Link>
            )}
            {familyMsg && <span className="text-xs text-slate-600">{familyMsg}</span>}
          </div>

          {/* Close */}
          <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-start">
            <select
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
              aria-label="What happened"
            >
              <option value="">What happened?</option>
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (e.g. bruise on left arm, BP 130/80)"
              className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <button
              onClick={close}
              disabled={busy === "close"}
              className="rounded-xl bg-slate-900 text-white font-bold px-5 py-2.5 text-sm disabled:opacity-60"
            >
              {busy === "close" ? "Saving…" : "Close alert"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="px-4 pb-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}

function Step({ n, text, active }: { n: number; text: string; active?: boolean }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl px-3 py-2 ${active ? "bg-red-50 text-red-900 font-semibold" : "bg-slate-50"}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${active ? "bg-red-600 text-white" : "bg-slate-300 text-white"}`}>
        {n}
      </span>
      {text}
    </p>
  );
}
