"use client";

/**
 * Shift handover generator.
 *
 * Builds the handover from the shift's real records (/api/handover), shows
 * it in a structured form, and lets the carer edit the final text before
 * saving it as a handover note for the next shift.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Copy,
  FileText,
  Loader2,
  Save,
  UserX,
  X,
} from "lucide-react";
import type { Handover } from "@/lib/handover/build";

const RANGES = [
  { label: "This shift", hours: 0 },
  { label: "Last 8 h", hours: 8 },
  { label: "Last 12 h", hours: 12 },
  { label: "Last 24 h", hours: 24 },
];

const LEVEL_CLS: Record<string, string> = {
  urgent: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  watch: "bg-yellow-50 text-yellow-700 border-yellow-200",
};

export default function HandoverModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hours, setHours] = useState(0);
  const [handover, setHandover] = useState<Handover | null>(null);
  const [text, setText] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (h: number) => {
    try {
      const res = await fetch(`/api/handover${h ? `?hours=${h}` : ""}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setHandover(json.handover);
      setText(json.handover.text);
      setWarnings(json.warnings ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build handover");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch: all state updates happen after the network call resolves.
  useEffect(() => {
    void (async () => {
      await load(0);
    })();
  }, [load]);

  const changeRange = (h: number) => {
    setHours(h);
    setLoading(true);
    setSaved(false);
    load(h);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Copy failed: select the text and copy it manually.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto sm:rounded-2xl rounded-t-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Shift handover"
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center gap-3 z-10">
          <div className="p-1.5 rounded-lg bg-[#EAF4F1] text-[#357366]">
            <ClipboardList className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-gray-900">
              {handover ? `${handover.shift} shift handover` : "Shift handover"}
            </h2>
            <p className="text-[11px] text-gray-500">Built from this shift&apos;s records. Edit before saving.</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex flex-wrap gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => changeRange(r.hours)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                  hours === r.hours ? "bg-[#357366] text-white border-[#357366]" : "bg-white text-gray-600 border-gray-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Gathering this shift&apos;s records…
            </div>
          ) : error && !handover ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : handover ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-gray-100 p-2.5">
                  <div className="text-xl font-bold text-gray-900">
                    {handover.stats.logged}/{handover.stats.residents}
                  </div>
                  <div className="text-[11px] text-gray-500">residents logged</div>
                </div>
                <div className="rounded-xl border border-gray-100 p-2.5">
                  <div className="text-xl font-bold text-red-600">{handover.priorities.filter((p) => p.level !== "watch").length}</div>
                  <div className="text-[11px] text-gray-500">urgent / high</div>
                </div>
                <div className="rounded-xl border border-gray-100 p-2.5">
                  <div className="text-xl font-bold text-gray-900">{handover.stats.logs}</div>
                  <div className="text-[11px] text-gray-500">care entries</div>
                </div>
              </div>

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> See first
                </h3>
                {handover.priorities.length === 0 ? (
                  <p className="text-sm text-gray-500">No priorities. Everyone is within their usual range.</p>
                ) : (
                  <ul className="space-y-2">
                    {handover.priorities.slice(0, 10).map((p) => (
                      <li key={p.resident_id} className="rounded-xl border border-gray-100 p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-gray-900">{p.name}</span>
                          {p.room && <span className="text-xs text-gray-500">Room {p.room}</span>}
                          <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-md border capitalize ${LEVEL_CLS[p.level]}`}>
                            {p.level}
                          </span>
                        </div>
                        <ul className="mt-1.5 text-xs text-gray-700 list-disc pl-5 space-y-0.5">
                          {p.reasons.slice(0, 4).map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                        {p.actions.length > 0 && (
                          <p className="mt-1.5 text-xs text-[#357366] font-medium">→ {p.actions.slice(0, 2).join(" · ")}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {handover.notLogged.length > 0 && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <h3 className="text-xs font-bold text-amber-800 mb-1 flex items-center gap-1.5">
                    <UserX className="w-3.5 h-3.5" /> No care log in this period ({handover.notLogged.length})
                  </h3>
                  <p className="text-xs text-amber-900">
                    {handover.notLogged.map((r) => `${r.name}${r.room ? ` (${r.room})` : ""}`).join(", ")}
                  </p>
                </section>
              )}

              {warnings.length > 0 && (
                <div className="text-[11px] text-gray-500 space-y-0.5">
                  {warnings.map((w) => (
                    <p key={w}>⚠ {w}</p>
                  ))}
                </div>
              )}

              <section>
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Handover text (editable)
                </h3>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setSaved(false);
                  }}
                  rows={14}
                  className="w-full font-mono text-xs leading-relaxed border border-gray-200 rounded-xl p-3 outline-none focus:border-[#4F9C8B]"
                  aria-label="Handover text"
                />
              </section>

              {error && <p className="text-xs text-red-700">{error}</p>}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={save}
                  disabled={saving || saved || text.trim().length < 5}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#357366] text-white text-sm font-semibold disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {saved ? "Saved for next shift" : "Save as handover note"}
                </button>
                <button
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                {handover.stats.simulatedExcluded > 0 && (
                  <span className="text-[11px] text-gray-500">
                    {handover.stats.simulatedExcluded} simulated entries excluded
                  </span>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
