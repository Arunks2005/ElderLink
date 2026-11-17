"use client";

/**
 * Live bed status (simulated load-cell sensor) for one ward.
 * Tap a bed to put the resident in bed / get them up; this is exactly what a
 * real bed sensor would send. Families see it as "Resting in bed" /
 * "Up and about" – nothing finer.
 */

import { useCallback, useEffect, useState } from "react";
import { BedDouble, Footprints, Loader2, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { durationText, isStale, PRESENCE_LABEL, routineState, sinceText, type Presence, type PresenceState } from "@/lib/presence";

type BedRow = { id: string; label: string; resident: { id: string; full_name: string } };

export default function LivePresencePanel({ wardName, beds }: { wardName: string; beds: BedRow[] }) {
  const [rows, setRows] = useState<Record<string, Presence>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const ids = beds.map((b) => b.resident.id).join(",");

  const load = useCallback(async () => {
    if (!ids) return;
    const { data, error: e } = await createClient()
      .from("resident_presence")
      .select("resident_id, state, since, source, updated_at")
      .in("resident_id", ids.split(","));
    if (e) setError(e.message);
    setRows(Object.fromEntries(((data ?? []) as Presence[]).map((p) => [p.resident_id, p])));
  }, [ids]);

  useEffect(() => {
    const supabase = createClient();
    const first = setTimeout(() => void load(), 0);
    const channel = supabase
      .channel(`presence-${wardName}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "resident_presence" }, () => void load())
      .subscribe();
    const tick = setInterval(() => setTick((t) => t + 1), 60000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [load, wardName]);

  async function set(residentIds: string[], state: (id: string) => { state: PresenceState; since: string }) {
    setError(null);
    const now = new Date().toISOString();
    const payload = residentIds.map((id) => ({ resident_id: id, ...state(id), source: "simulated", updated_at: now }));
    const { error: e } = await createClient().from("resident_presence").upsert(payload, { onConflict: "resident_id" });
    if (e) setError(e.message);
    await load();
  }

  async function toggle(id: string) {
    setBusy(id);
    const next: PresenceState = rows[id]?.state === "in_bed" ? "up" : "in_bed";
    await set([id], () => ({ state: next, since: new Date().toISOString() }));
    setBusy(null);
  }

  async function fromRoutine() {
    setBusy("routine");
    const r = routineState();
    await set(
      beds.map((b) => b.resident.id),
      () => ({ state: r.state, since: r.since.toISOString() })
    );
    setBusy(null);
  }

  return (
    <section className="bg-white rounded-3xl border border-slate-100 p-4 sm:p-5 shadow-xs space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="p-2 rounded-xl bg-emerald-50 text-emerald-700 shrink-0">
          <BedDouble className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">
            {wardName}: live bed status <span className="text-[10px] font-bold uppercase ml-1 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">Simulated</span>
          </h2>
          <p className="text-xs text-slate-600">
            What each bed&apos;s load-cell sensor would report right now. Tap a bed to put the resident in bed or get them up.
            Families see only &quot;Resting in bed&quot; or &quot;Up and about&quot;.
          </p>
        </div>
        <button
          onClick={fromRoutine}
          disabled={busy === "routine"}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white disabled:opacity-50"
        >
          {busy === "routine" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Set from daily routine
        </button>
      </div>
      <div className="grid [grid-template-columns:repeat(auto-fill,minmax(170px,1fr))] gap-2">
        {beds.map((b) => {
          const p = rows[b.resident.id];
          const stale = p ? isStale(p) : true;
          const inBed = p?.state === "in_bed";
          return (
            <button
              key={b.id}
              onClick={() => toggle(b.resident.id)}
              disabled={busy === b.resident.id}
              className={`text-left rounded-2xl border-2 px-3 py-2.5 transition ${
                !p || stale ? "border-slate-200 bg-slate-50" : inBed ? "border-indigo-200 bg-indigo-50" : "border-emerald-200 bg-emerald-50"
              }`}
              aria-label={`${b.resident.full_name}: ${p ? PRESENCE_LABEL[p.state].staff : "unknown"}. Tap to change.`}
            >
              <p className="text-[11px] font-bold uppercase text-slate-500">{b.label}</p>
              <p className="font-bold text-sm truncate">{b.resident.full_name}</p>
              <p className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${!p || stale ? "text-slate-500" : inBed ? "text-indigo-800" : "text-emerald-800"}`}>
                {busy === b.resident.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : inBed ? (
                  <BedDouble className="w-3.5 h-3.5" />
                ) : (
                  <Footprints className="w-3.5 h-3.5" />
                )}
                {!p ? "No data" : stale ? "No recent data" : `${PRESENCE_LABEL[p.state].staff} · ${durationText(p.since)}`}
              </p>
              {p && !stale && <p className="text-[10px] text-slate-500">since {sinceText(p.since)}</p>}
            </button>
          );
        })}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}
