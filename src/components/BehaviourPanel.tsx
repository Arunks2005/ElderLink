"use client";

/**
 * Behaviour analysis panel (staff dashboard, left column).
 *
 * One place for "is anyone different from their normal?". It runs the
 * personal-baseline engine (care logs + night sensors, 1-week normal) and:
 *   - re-runs whenever new data arrives (`dataVersion` changes: a care log
 *     was saved or sensor nights were stored) and every 5 minutes;
 *   - shows each anomaly with its reason and the first action, or a clear
 *     "everything is normal" message;
 *   - records new flags as behaviour alerts (deduplicated, at most every
 *     10 minutes) so they reach the handover and the alert history.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, CheckCircle2, ChevronDown, ChevronUp, ClipboardPlus, Loader2, Radar, RefreshCw } from "lucide-react";
import type { FacilityReport, ResidentReport } from "@/lib/early-warning/engine";

const REFRESH_MS = 5 * 60 * 1000;
const PERSIST_EVERY_MS = 10 * 60 * 1000;

const STATUS_CHIP: Record<string, { label: string; cls: string }> = {
  act: { label: "Act today", cls: "bg-red-50 text-red-700 border-red-200" },
  watch: { label: "Watch", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

function AnomalyCard({ r }: { r: ResidentReport }) {
  const [open, setOpen] = useState(false);
  const chip = STATUS_CHIP[r.status];
  const first = r.patterns[0];
  const action = r.topActions[0];
  return (
    <li className="py-2">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left flex items-start gap-2" aria-expanded={open}>
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${r.status === "act" ? "bg-red-500" : "bg-amber-400"}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-slate-900 truncate">{r.name}</span>
            {chip && <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${chip.cls}`}>{chip.label}</span>}
          </span>
          <span className="block text-[11px] text-slate-500 truncate">
            {r.room ? `${r.room} · ` : ""}
            {first ? first.title : r.summary}
          </span>
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />}
      </button>
      {open && (
        <div className="mt-2 ml-4 space-y-2 text-xs">
          {action && <p className="text-[#357366] font-semibold">→ {action}</p>}
          {r.patterns.length > 0 ? (
            r.patterns.map((p) => (
              <div key={p.id} className="rounded-xl bg-slate-50 p-2">
                <p className="font-semibold text-slate-800">{p.title}</p>
                <p className="text-slate-600 mt-0.5">{p.why}</p>
                <ul className="list-disc pl-4 mt-1 text-slate-600 space-y-0.5">
                  {p.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <ul className="list-disc pl-4 text-slate-600 space-y-0.5">
              {r.flaggedSignals.map((s) => (
                <li key={s.key}>
                  {s.explanation}
                  {s.source === "sensor" ? " (sensor)" : ""}
                </li>
              ))}
              {r.attention.explanation && <li>{r.attention.explanation}</li>}
              {r.connection.status !== "ok" && <li>{r.connection.explanation}</li>}
            </ul>
          )}
          <div className="flex gap-2">
            <Link
              href={`/staff/residents/${r.resident_id}/log`}
              className="inline-flex items-center gap-1 rounded-lg bg-[#357366] text-white font-semibold px-2.5 py-1.5"
            >
              <ClipboardPlus className="w-3.5 h-3.5" /> Log care
            </Link>
            <Link
              href={`/staff/residents/${r.resident_id}/history`}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 text-slate-700 font-semibold px-2.5 py-1.5"
            >
              History
            </Link>
          </div>
          <p className="text-[10px] text-slate-400">Screening prompt, not a diagnosis.</p>
        </div>
      )}
    </li>
  );
}

export default function BehaviourPanel({
  dataVersion,
  onReport,
}: {
  dataVersion: number;
  onReport?: (report: FacilityReport) => void;
}) {
  const [report, setReport] = useState<FacilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const lastPersist = useRef(0);
  const inFlight = useRef(false);

  const analyse = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch("/api/early-warning", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Analysis failed (${res.status})`);
      const rep = json.report as FacilityReport;
      setReport(rep);
      setError(null);
      setLastRun(new Date(rep.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      onReport?.(rep);

      // Keep the alert history and handover in step (deduplicated server-side).
      const flagged = rep.residents.some((r) => r.flaggedSignals.length > 0);
      if (flagged && Date.now() - lastPersist.current > PERSIST_EVERY_MS) {
        lastPersist.current = Date.now();
        void fetch("/api/early-warning", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }, [onReport]);

  // Run on mount and whenever new data arrives (debounced), plus every 5 min.
  useEffect(() => {
    const t = setTimeout(() => void analyse(), dataVersion === 0 ? 0 : 3000);
    return () => clearTimeout(t);
  }, [dataVersion, analyse]);

  useEffect(() => {
    const id = setInterval(() => void analyse(), REFRESH_MS);
    return () => clearInterval(id);
  }, [analyse]);

  const anomalies = (report?.residents ?? []).filter((r) => r.status === "act" || r.status === "watch");
  const learning = report?.totals.buildingBaseline ?? 0;
  const total = report?.totals.residents ?? 0;

  return (
    <section className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-700">
            <Activity className="w-4 h-4" />
          </div>
          <h2 className="font-bold text-slate-900">Behaviour analysis</h2>
          <button
            onClick={() => {
              setRunning(true);
              void analyse();
            }}
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:bg-slate-50"
            aria-label="Analyse now"
            title="Analyse now"
          >
            <RefreshCw className={`w-4 h-4 ${running ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Live · vs each resident&apos;s 1-week normal
          {lastRun ? ` · ${lastRun}` : ""}
        </p>
      </div>

      <div className="px-4 py-3 space-y-2">
        {!report && !error ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Analysing…
          </div>
        ) : error && !report ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
        ) : anomalies.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
            <p className="font-bold text-emerald-900 mt-1">Everything is normal</p>
            <p className="text-xs text-emerald-800 mt-0.5">
              All {total - learning} residents are within their usual pattern.
              {learning > 0 ? ` ${learning} still building a 1-week normal.` : ""}
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs font-semibold text-slate-600">
              {anomalies.length} resident{anomalies.length === 1 ? " differs" : "s differ"} from their normal · tap for why
            </p>
            <ul className="divide-y divide-slate-100">
              {(showAll ? anomalies : anomalies.slice(0, 5)).map((r) => (
                <AnomalyCard key={r.resident_id} r={r} />
              ))}
            </ul>
            {anomalies.length > 5 && (
              <button onClick={() => setShowAll((s) => !s)} className="text-xs font-semibold text-indigo-700 hover:underline">
                {showAll ? "Show fewer" : `Show all ${anomalies.length}`}
              </button>
            )}
          </>
        )}
        {error && report && <p className="text-[11px] text-red-600">Last update failed: {error}</p>}
      </div>

      <div className="px-4 pb-4 flex items-center gap-3 text-[11px]">
        <Radar className="w-3.5 h-3.5 text-indigo-500" />
        <Link href="/staff/early-warning" className="font-semibold text-indigo-700 hover:underline">
          Full report
        </Link>
        <Link href="/staff/behavior-alerts" className="font-semibold text-indigo-700 hover:underline">
          Alert history
        </Link>
      </div>
    </section>
  );
}
