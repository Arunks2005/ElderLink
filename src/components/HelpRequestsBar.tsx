"use client";

/**
 * Live help requests ("need a second pair of hands") on the dashboards.
 * Open -> someone taps "On my way" -> "Done". Hidden when there are none.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, HelpCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getMe } from "@/lib/care/me";

type Req = {
  id: string;
  resident_id: string | null;
  message: string | null;
  status: string | null;
  created_at: string | null;
  requested_by_name: string | null;
  location: string | null;
  accepted_by_name: string | null;
  resident: { full_name: string; room_number: string | null } | null;
};

const WINDOW_H = 12;

function ago(iso: string | null) {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

export default function HelpRequestsBar() {
  const [reqs, setReqs] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const supabase = createClient();
    const since = new Date(Date.now() - WINDOW_H * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from("assistance_requests")
      .select("id, resident_id, message, status, created_at, requested_by_name, location, accepted_by_name, resident:residents(full_name, room_number)")
      .in("status", ["open", "pending", "accepted"])
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    setReqs(
      ((data ?? []) as unknown as (Omit<Req, "resident"> & { resident: Req["resident"] | Req["resident"][] })[]).map((r) => ({
        ...r,
        resident: Array.isArray(r.resident) ? r.resident[0] ?? null : r.resident,
      }))
    );
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const first = setTimeout(() => void load(), 0);
    const channel = supabase
      .channel("elderlink-help-requests")
      .on("postgres_changes", { event: "*", schema: "public", table: "assistance_requests" }, () => void load())
      .subscribe();
    const tick = setInterval(() => setTick((t) => t + 1), 30000);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  async function update(r: Req, next: "accepted" | "done") {
    setBusy(r.id);
    const supabase = createClient();
    const me = await getMe(supabase);
    await supabase
      .from("assistance_requests")
      .update(
        next === "accepted"
          ? { status: "accepted", accepted_by: me?.id ?? null, accepted_by_name: me?.name ?? "Staff", accepted_at: new Date().toISOString() }
          : { status: "done", resolved_at: new Date().toISOString() }
      )
      .eq("id", r.id);
    setBusy(null);
    void load();
  }

  if (reqs.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 space-y-2" aria-live="polite">
      <p className="flex items-center gap-1.5 text-sm font-bold text-amber-900">
        <HelpCircle className="w-4 h-4" /> {reqs.length} help request{reqs.length === 1 ? "" : "s"}
      </p>
      <ul className="space-y-1.5">
        {reqs.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white border border-amber-100 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-bold text-slate-900">
                {r.resident_id ? (
                  <Link href={`/staff/residents/${r.resident_id}`} className="hover:underline">
                    {r.resident?.full_name ?? "Resident"}
                  </Link>
                ) : (
                  "General"
                )}
              </span>
              <span className="text-slate-500"> · {r.location ?? r.resident?.room_number ?? ""}</span>
              <span className="block text-slate-700">{r.message}</span>
              <span className="block text-[11px] text-slate-400">
                {r.requested_by_name ? `${r.requested_by_name} · ` : ""}
                {ago(r.created_at)}
                {r.status === "accepted" && r.accepted_by_name ? ` · ${r.accepted_by_name} is on the way` : ""}
              </span>
            </span>
            {r.status === "accepted" ? (
              <button
                onClick={() => update(r, "done")}
                disabled={busy === r.id}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white font-bold px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Done
              </button>
            ) : (
              <button
                onClick={() => update(r, "accepted")}
                disabled={busy === r.id}
                className="rounded-lg bg-amber-500 text-white font-bold px-3 py-1.5 text-xs disabled:opacity-60"
              >
                {busy === r.id ? "…" : "On my way"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
