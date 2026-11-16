"use client";

/**
 * Early Warning / Care Rounds page.
 *
 * Shows, for every resident, whether their own recent care-log pattern has
 * drifted from their personal baseline, which recognised combination of
 * signals that matches, and what a carer should do about it. The list is
 * ordered as a "care round": who to see first this shift.
 *
 * Two data modes, always clearly labelled:
 *   - LIVE: real entries from care_logs_demo, via /api/early-warning
 *           (authenticated, RLS-scoped). Simulated "sensor" rows are excluded
 *           unless the user explicitly includes them.
 *   - SIMULATED DEMO: fictional residents generated in memory. Nothing is
 *           read from or written to the database.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  EyeOff,
  FlaskConical,
  HeartPulse,
  Info,
  Languages,
  ListChecks,
  Loader2,
  MessageCircleHeart,
  Radar,
  RefreshCw,
  Send,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  BASELINE_END,
  BASELINE_START,
  MIN_BASELINE_DAYS,
  RECENT_DAYS,
  runEarlyWarning,
  type FacilityReport,
  type ResidentReport,
  type ResidentStatus,
  type Severity,
  type SignalResult,
} from "@/lib/early-warning/engine";
import { buildDemoCohort, DEMO_LABEL, DEMO_SCENARIOS } from "@/lib/early-warning/demo-cohort";
import {
  NUDGE_LANGUAGES,
  templateNudge,
  whatsappLink,
  type NudgeLanguage,
} from "@/lib/early-warning/nudge";

type Mode = "live" | "demo";

const STATUS_META: Record<ResidentStatus, { label: string; cls: string; dot: string }> = {
  act: { label: "Act today", cls: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-500" },
  watch: { label: "Watch", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  stable: { label: "Stable", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  baseline: { label: "Learning baseline", cls: "bg-gray-50 text-gray-600 border-gray-200", dot: "bg-gray-400" },
};

const SEVERITY_CLS: Record<Severity, string> = {
  severe: "bg-red-50 text-red-700 border-red-200",
  moderate: "bg-amber-50 text-amber-700 border-amber-200",
  mild: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

const fmt = (s: SignalResult, v: number | null) => {
  if (v === null) return "–";
  if (s.key === "temperature") return `${v.toFixed(1)}°F`;
  if (s.key === "pain") return `${v.toFixed(1)}/10`;
  if (s.key === "heart_rate") return `${Math.round(v)}`;
  if (s.key === "sleep_hours") return `${v.toFixed(1)} h`;
  if (s.key === "washroom_visits" || s.key === "night_bed_exits") return `${v.toFixed(1)}/night`;
  if (s.key === "night_breathing") return `${v.toFixed(1)}/min`;
  return `${Math.round(v)}%`;
};

/* ------------------------------------------------------------------ */
/* Sparkline: 28 daily values with the personal baseline band          */
/* ------------------------------------------------------------------ */

function Sparkline({ s }: { s: SignalResult }) {
  const W = 140;
  const H = 34;
  const vals = s.series.filter((v): v is number => v !== null);
  if (vals.length < 2) return <span className="text-[11px] text-gray-400">not enough data</span>;
  const band =
    s.baselineMean !== null && s.baselineSd !== null
      ? [s.baselineMean - s.baselineSd, s.baselineMean + s.baselineSd]
      : null;
  const lo = Math.min(...vals, ...(band ?? []));
  const hi = Math.max(...vals, ...(band ?? []));
  const span = hi - lo || 1;
  const n = s.series.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 6);
  let d = "";
  s.series.forEach((v, i) => {
    if (v === null) return;
    d += `${d === "" ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
  });
  const recentStart = x(n - RECENT_DAYS) - 2;
  const stroke = s.severity ? "#dc2626" : "#4F9C8B";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label={`${s.label} over 28 days`} role="img">
      <rect x={recentStart} y={0} width={W - recentStart} height={H} fill="#f3f4f6" />
      {band && (
        <rect
          x={x(n - 1 - BASELINE_END)}
          width={x(n - 1 - BASELINE_START) - x(n - 1 - BASELINE_END)}
          y={y(band[1])}
          height={Math.max(1, y(band[0]) - y(band[1]))}
          fill="#4F9C8B"
          opacity={0.12}
        />
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Family call-request panel                                           */
/* ------------------------------------------------------------------ */

function NudgePanel({ r, homeName }: { r: ResidentReport; homeName: string }) {
  const [lang, setLang] = useState<NudgeLanguage>("hi");
  const [text, setText] = useState<string>("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const draft = async () => {
    setCopied(false);
    setNote(null);
    const local = templateNudge(lang, r.firstName, homeName);
    if (local) {
      setText(local);
      setNote("Fixed template: no AI, no data leaves ElderLink.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/family-nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: r.firstName, language: lang }),
      });
      const json = await res.json();
      if (res.ok) {
        setText(json.message);
        setNote(json.note ?? null);
      } else {
        setText(json.fallback ?? templateNudge("en", r.firstName, homeName) ?? "");
        setNote(`${json.error ?? "Translation unavailable"}: showing English instead.`);
      }
    } catch {
      setText(templateNudge("en", r.firstName, homeName) ?? "");
      setNote("Offline: showing English instead.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setNote("Copy failed: select the text and copy it manually.");
    }
  };

  const wa = whatsappLink(r.connection.primaryContact?.phone, text);

  return (
    <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Languages className="w-4 h-4 text-indigo-600" />
        <span className="text-xs font-semibold text-indigo-900">
          Call request to {r.connection.primaryContact?.full_name ?? "family"}
          {r.connection.primaryContact?.relationship ? ` (${r.connection.primaryContact.relationship})` : ""}
        </span>
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as NudgeLanguage)}
          className="ml-auto text-xs border border-indigo-200 rounded-lg px-2 py-1 bg-white"
          aria-label="Message language"
        >
          {NUDGE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
        <button
          onClick={draft}
          disabled={busy}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageCircleHeart className="w-3.5 h-3.5" />}
          Draft message
        </button>
      </div>
      {text && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            className="w-full text-sm border border-indigo-200 rounded-lg p-2 bg-white"
            aria-label="Message text"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={copy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
            {wa ? (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1"
              >
                <Send className="w-3.5 h-3.5" /> Open in WhatsApp
              </a>
            ) : (
              <span className="text-[11px] text-gray-500">No phone on file: copy and send manually.</span>
            )}
            <span className="text-[11px] text-gray-500">
              Contains the first name only. No health information is shared.
            </span>
          </div>
        </>
      )}
      {note && <p className="text-[11px] text-indigo-700">{note}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resident card                                                        */
/* ------------------------------------------------------------------ */

function ResidentCard({
  r,
  rank,
  mode,
  homeName,
}: {
  r: ResidentReport;
  rank: number;
  mode: Mode;
  homeName: string;
}) {
  const [open, setOpen] = useState(rank <= 2 && r.status !== "stable");
  const [done, setDone] = useState<Record<string, boolean>>({});
  const meta = STATUS_META[r.status];
  const scenario = mode === "demo" ? DEMO_SCENARIOS.find((s) => s.resident.id === r.resident_id) : null;
  const signalsWithData = r.signals.filter((s) => s.baselineMean !== null);

  return (
    <li className="bg-white border border-gray-100 rounded-2xl shadow-xs overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left p-4 sm:p-5 flex items-start gap-4 hover:bg-gray-50/60"
        aria-expanded={open}
      >
        <div className="w-8 h-8 shrink-0 rounded-full bg-[#EAF4F1] text-[#357366] font-bold text-sm flex items-center justify-center">
          {rank}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-gray-900">{r.name}</span>
            {r.room && <span className="text-xs text-gray-500">{r.room}</span>}
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border inline-flex items-center gap-1 ${meta.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            {r.attention.underObserved && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-purple-50 text-purple-700 border-purple-200 inline-flex items-center gap-1">
                <EyeOff className="w-3 h-3" /> Under-observed
              </span>
            )}
            {r.connection.status === "none" && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-slate-50 text-slate-700 border-slate-200 inline-flex items-center gap-1">
                <UserX className="w-3 h-3" /> No family
              </span>
            )}
            {r.connection.status === "gap" && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-indigo-50 text-indigo-700 border-indigo-200 inline-flex items-center gap-1">
                <MessageCircleHeart className="w-3 h-3" />
                {r.connection.daysSinceFamilyContact === null
                  ? "No family contact"
                  : `${r.connection.daysSinceFamilyContact}d since family contact`}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-1">{r.summary}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Drift</div>
          <div className={`text-xl font-bold ${r.driftIndex >= 50 ? "text-red-600" : r.driftIndex > 0 ? "text-amber-600" : "text-gray-400"}`}>
            {r.driftIndex}
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 mt-1" /> : <ChevronDown className="w-4 h-4 text-gray-400 mt-1" />}
      </button>

      {open && (
        <div className="px-4 sm:px-5 pb-5 space-y-4 border-t border-gray-50">
          {scenario && (
            <div className="mt-3 text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 p-2.5">
              <span className="font-bold">Simulated scenario:</span> {scenario.story}
              <br />
              <span className="font-bold">What the engine should do:</span> {scenario.expected}
            </div>
          )}

          {r.topActions.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                <ListChecks className="w-3.5 h-3.5" /> This shift
              </h4>
              <ul className="space-y-1.5">
                {r.topActions.map((a) => (
                  <li key={a}>
                    <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!done[a]}
                        onChange={(e) => setDone((d) => ({ ...d, [a]: e.target.checked }))}
                        className="mt-0.5 accent-[#4F9C8B]"
                      />
                      <span className={done[a] ? "line-through text-gray-400" : ""}>{a}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.patterns.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span className="font-semibold text-sm text-gray-900">{p.title}</span>
                <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-md border ${SEVERITY_CLS[p.severity]}`}>
                  {p.severity}
                </span>
              </div>
              <p className="text-xs text-gray-600 mt-1.5">{p.why}</p>
              <ul className="mt-2 text-xs text-gray-700 list-disc pl-5 space-y-0.5">
                {p.evidence.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-400 mt-2">Screening prompt, not a diagnosis. Follow your nurse&apos;s judgement.</p>
            </div>
          ))}

          {signalsWithData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-400 uppercase tracking-wider">
                    <th className="py-1.5 pr-3 font-semibold">Signal</th>
                    <th className="py-1.5 pr-3 font-semibold">Usual</th>
                    <th className="py-1.5 pr-3 font-semibold">Last {RECENT_DAYS}d</th>
                    <th className="py-1.5 pr-3 font-semibold">Change</th>
                    <th className="py-1.5 font-semibold">28 days (band = personal normal, grey = recent)</th>
                  </tr>
                </thead>
                <tbody>
                  {signalsWithData.map((s) => (
                    <tr key={s.key} className="border-t border-gray-50">
                      <td className="py-1.5 pr-3 font-medium text-gray-800">
                        {s.label}
                        {s.source === "sensor" && (
                          <span className="ml-1 text-[10px] font-semibold text-indigo-600 bg-indigo-50 border border-indigo-100 px-1 rounded">sensor</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-gray-600">{fmt(s, s.baselineMean)}</td>
                      <td className="py-1.5 pr-3 text-gray-800 font-semibold">{fmt(s, s.recentMean)}</td>
                      <td className="py-1.5 pr-3">
                        {s.deviation === null ? (
                          "–"
                        ) : s.severity ? (
                          <span className={`px-1.5 py-0.5 rounded border font-bold ${SEVERITY_CLS[s.severity]}`}>
                            {s.deviation.toFixed(1)} SD worse
                          </span>
                        ) : (
                          <span className="text-gray-400">{s.deviation > 0 ? `${s.deviation.toFixed(1)} SD` : "normal"}</span>
                        )}
                      </td>
                      <td className="py-1.5">
                        <Sparkline s={s} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-gray-500 mt-3">
              Not enough history yet: {r.dataQuality.baselineDaysWithData} of {MIN_BASELINE_DAYS} baseline days logged.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="font-semibold text-gray-800 flex items-center gap-1.5 mb-1">
                <MessageCircleHeart className="w-3.5 h-3.5 text-indigo-600" /> Connection
              </div>
              <p className="text-gray-600">{r.connection.explanation}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="font-semibold text-gray-800 flex items-center gap-1.5 mb-1">
                <EyeOff className="w-3.5 h-3.5 text-purple-600" /> Attention this week
              </div>
              <p className="text-gray-600">
                {r.attention.explanation ??
                  `${r.attention.logsLast7Days} observations this week (home median ${r.attention.facilityMedianLast7Days}).`}
              </p>
            </div>
          </div>

          {r.connection.status !== "none" && (r.connection.status === "gap" || r.connection.lonelinessRisk || r.patterns.some((p) => p.id === "withdrawal")) && (
            <NudgePanel r={r} homeName={homeName} />
          )}

          <p className="text-[11px] text-gray-400">
            Based on {r.dataQuality.logsUsed} care-log entries
            {r.dataQuality.logsExcluded > 0 ? `; ${r.dataQuality.logsExcluded} simulated entries excluded` : ""}.
          </p>
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export default function EarlyWarningPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("live");
  const [authChecked, setAuthChecked] = useState(false);
  const [liveReport, setLiveReport] = useState<FacilityReport | null>(null);
  const [demoReport, setDemoReport] = useState<FacilityReport | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [includeSimulated, setIncludeSimulated] = useState(false);
  // entry_source values the server actually used (demo data can be switched
  // on server-wide with ELDERLINK_INCLUDE_DEMO_DATA=true).
  const [liveSources, setLiveSources] = useState<string[]>(["manual"]);
  const [showMethod, setShowMethod] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const homeName = "ElderLink Care Home";

  const fetchLive = useCallback(async (withSimulated: boolean) => {
    try {
      const res = await fetch(`/api/early-warning${withSimulated ? "?sources=manual,sensor,demo" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setLiveReport(json.report);
      setLiveSources(Array.isArray(json.sources) ? json.sources : ["manual"]);
      setWarnings(json.warnings ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load live data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
      await fetchLive(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, fetchLive]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setSaveMsg(null);
    if (m === "demo") setDemoReport(runEarlyWarning({ ...buildDemoCohort(new Date()) }));
  };

  const refresh = () => {
    setSaveMsg(null);
    if (mode === "demo") {
      setDemoReport(runEarlyWarning({ ...buildDemoCohort(new Date()) }));
      return;
    }
    setLoading(true);
    fetchLive(includeSimulated);
  };

  const toggleSimulated = (v: boolean) => {
    setIncludeSimulated(v);
    setLoading(true);
    fetchLive(v);
  };

  const saveAlerts = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/early-warning?sources=${liveSources.join(",")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSaveMsg(
        `${json.inserted} new alert${json.inserted === 1 ? "" : "s"} sent to Behaviour Alerts` +
          (json.skipped ? ` (${json.skipped} already open)` : "") +
          "."
      );
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const report = mode === "demo" ? demoReport : liveReport;
  const liveHasNoBaseline = mode === "live" && liveReport && liveReport.totals.buildingBaseline === liveReport.totals.residents;

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAF8] text-[#1F2937]">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-[#FAFAF8]/85 border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2 sm:gap-3">
          <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-gray-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-[#EAF4F1] text-[#4F9C8B] hidden sm:block">
            <Radar className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm sm:text-base leading-tight">Early Warning</h1>
            <p className="text-[11px] text-gray-500 hidden sm:block">Each resident compared with their own normal, not an average</p>
          </div>
          <div className="ml-auto flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1">
            <button
              onClick={() => switchMode("live")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${mode === "live" ? "bg-[#357366] text-white" : "text-gray-600"}`}
            >
              <Database className="w-3.5 h-3.5" /> Live data
            </button>
            <button
              onClick={() => switchMode("demo")}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${mode === "demo" ? "bg-amber-500 text-white" : "text-gray-600"}`}
            >
              <FlaskConical className="w-3.5 h-3.5" /> Simulated demo
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {mode === "demo" ? (
          <div className="rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <FlaskConical className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>{DEMO_LABEL}.</strong> The same engine runs on these fictional residents as on the live
              data. Each card shows the scripted scenario so you can check the result.
            </span>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-900 flex flex-wrap items-center gap-3">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>
              <strong>Live data</strong> from staff care logs.{" "}
              {liveSources.includes("demo") && (
                <strong className="text-amber-700">Includes seeded DEMO care logs. </strong>
              )}
              {liveSources.includes("sensor") ? "Simulated sensor entries are INCLUDED." : "Simulated sensor entries are excluded."}
            </span>
            <label className="ml-auto text-xs inline-flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={includeSimulated} onChange={(e) => toggleSimulated(e.target.checked)} />
              Include simulated entries
            </label>
          </div>
        )}

        {mode === "live" && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}. Use <button className="underline font-semibold" onClick={() => switchMode("demo")}>Simulated demo</button> to see the engine working.
          </div>
        )}
        {mode === "live" && warnings.map((w) => (
          <div key={w} className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">{w}</div>
        ))}
        {liveHasNoBaseline && (
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700 flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" />
            <span>
              No resident has {MIN_BASELINE_DAYS}+ days of history yet, so the engine is still learning their normal.
              It needs about a week of everyday logging. Switch to <strong>Simulated demo</strong> to see it with 4 weeks of data.
            </span>
          </div>
        )}

        {/* Totals */}
        {report && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              { label: "Act today", v: report.totals.act, icon: AlertTriangle, cls: "text-red-600" },
              { label: "Watch", v: report.totals.watch, icon: Activity, cls: "text-amber-600" },
              { label: "Under-observed", v: report.totals.underObserved, icon: EyeOff, cls: "text-purple-600" },
              { label: "Family gap / none", v: report.totals.connectionGaps + report.totals.noFamily, icon: MessageCircleHeart, cls: "text-indigo-600" },
              { label: "Not seen 24h", v: report.totals.notObservedToday, icon: HeartPulse, cls: "text-gray-700" },
            ].map((t) => (
              <div key={t.label} className="bg-white border border-gray-100 rounded-2xl p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  <t.icon className={`w-3.5 h-3.5 ${t.cls}`} /> {t.label}
                </div>
                <div className={`text-2xl font-bold mt-1 ${t.cls}`}>{t.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={refresh}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading && mode === "live" ? "animate-spin" : ""}`} /> Recalculate
          </button>
          <button
            onClick={() => setShowMethod((s) => !s)}
            className="text-xs font-semibold px-3 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 inline-flex items-center gap-1.5"
          >
            <Info className="w-3.5 h-3.5" /> How it works
          </button>
          {mode === "live" && report && report.totals.act + report.totals.watch > 0 && (
            <button
              onClick={saveAlerts}
              disabled={saving}
              className="text-xs font-semibold px-3 py-2 rounded-xl bg-[#357366] text-white hover:bg-[#2c6156] disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              Send flags to Behaviour Alerts
            </button>
          )}
          {saveMsg && <span className="text-xs text-gray-600">{saveMsg}</span>}
          {report && (
            <span className="ml-auto text-[11px] text-gray-400">
              {report.totals.logsUsed} entries analysed · {new Date(report.generatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {showMethod && (
          <div className="bg-white border border-gray-100 rounded-2xl p-4 text-sm text-gray-700 space-y-2">
            <p>
              <strong>1. One-week personal normal.</strong> For each resident, days {BASELINE_START + 1} to{" "}
              {BASELINE_END + 1} ago become one value per day for each signal. From care logs: hydration, meals, mood,
              confusion, medication, pain, temperature and heart rate. From ward sensors: sleep hours, night
              bathroom visits, night bed exits and breathing while asleep. This week is that resident&apos;s normal.
            </p>
            <p>
              <strong>2. Recent vs. normal.</strong> The last {RECENT_DAYS} days are compared with that normal
              in personal standard deviations (a z-score). Day {RECENT_DAYS + 1} is skipped, so the start of a
              change doesn&apos;t become part of its own normal. A change must exceed 1.5 SD <em>and</em> show on at least 2
              separate days. Each signal has a minimum SD, so very consistent residents aren&apos;t flagged for
              tiny changes.
            </p>
            <p>
              <strong>3. Patterns, not single numbers.</strong> Known combinations become screening prompts
              with actions: low fluids with new confusion (dehydration / urinary infection), more night bathroom
              trips (urinary), restless nights (pain, delirium, fall risk), faster breathing asleep (chest
              infection, heart failure), eating less with low mood and no family contact (withdrawal),
              refused medication, rising pain.
            </p>
            <p>
              <strong>4. The two social signals:</strong> days since the family last made contact, and
              attention equity. Attention equity flags a resident observed less than half as often as the
              home average, because quiet residents are the easiest to overlook.
            </p>
            <p className="text-xs text-gray-500">
              No paid APIs and no AI in the detection step; every flag shows the numbers behind it. Sensor
              signals are marked &quot;sensor&quot; (currently simulated). Tested on 300 simulated stable residents:
              about 3% wrongly marked &quot;Act today&quot; with a 1-week normal (run <code>npm run test:early-warning</code>).
            </p>
          </div>
        )}

        {loading && mode === "live" && !liveReport ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Analysing care logs…
          </div>
        ) : report ? (
          report.residents.length === 0 ? (
            <p className="text-sm text-gray-500 py-10 text-center">No active residents found.</p>
          ) : (
            <ol className="space-y-3">
              {report.residents.map((r, i) => (
                <ResidentCard key={`${mode}-${r.resident_id}`} r={r} rank={i + 1} mode={mode} homeName={homeName} />
              ))}
            </ol>
          )
        ) : null}
      </main>
    </div>
  );
}
