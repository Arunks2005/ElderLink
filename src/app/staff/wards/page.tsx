"use client";

/**
 * Staff ward map. Shared wards drawn as beds along an aisle, with the shared
 * bathroom at the end, so a carer can see the whole ward at a glance:
 * who has been logged today, open fall alerts, behaviour alerts and Early
 * Warning status. Tap a bed for its actions; "Next unlogged bed" walks the
 * round in order.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  BedDouble,
  Brain,
  Check,
  ClipboardPlus,
  History,
  Loader2,
  QrCode as QrIcon,
  Radar,
  RefreshCw,
  ShowerHead,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DEVICE_LABEL, loadWards, type Bed, type Ward } from "@/lib/wards/wards";

type EwStatus = "act" | "watch" | "stable" | "baseline";

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const EW_CHIP: Record<EwStatus, { label: string; cls: string } | null> = {
  act: { label: "Act today", cls: "bg-red-50 text-red-700 border-red-200" },
  watch: { label: "Watch", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  stable: null,
  baseline: null,
};

function BedCard({
  bed,
  logged,
  fall,
  alerts,
  ew,
  open,
  onToggle,
}: {
  bed: Bed;
  logged: boolean;
  fall: boolean;
  alerts: number;
  ew: EwStatus | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const r = bed.resident;
  const chip = ew ? EW_CHIP[ew] : null;
  const border = fall ? "border-red-500 ring-2 ring-red-200" : chip?.label === "Act today" ? "border-red-300" : !r ? "border-dashed border-slate-200" : "border-slate-200";
  return (
    <div className={`rounded-2xl border-2 bg-white ${border} transition-all`}>
      <button onClick={onToggle} className="w-full text-left p-3" aria-expanded={open} disabled={!r}>
        <div className="flex items-center gap-2">
          <BedDouble className={`w-4 h-4 ${r ? "text-slate-500" : "text-slate-300"}`} />
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{bed.label}</span>
          {r &&
            (logged ? (
              <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                <Check className="w-3 h-3" /> Logged
              </span>
            ) : (
              <span className="ml-auto text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-md">Not logged</span>
            ))}
        </div>
        <div className={`mt-1 font-bold leading-tight ${r ? "text-slate-900" : "text-slate-300"}`}>{r?.full_name ?? "Empty bed"}</div>
        {r && (fall || chip || alerts > 0) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {fall && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black text-white bg-red-600 px-1.5 py-0.5 rounded-md animate-pulse">
                <AlertTriangle className="w-3 h-3" /> FALL ALERT
              </span>
            )}
            {chip && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${chip.cls}`}>{chip.label}</span>}
            {alerts > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-indigo-50 text-indigo-700 border-indigo-200">
                {alerts} behaviour alert{alerts === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </button>
      {open && r && (
        <div className="px-3 pb-3 grid grid-cols-3 gap-1.5">
          <Link href={`/staff/residents/${r.id}/log`} className="flex flex-col items-center gap-1 rounded-xl bg-[#357366] text-white text-[11px] font-bold py-2">
            <ClipboardPlus className="w-4 h-4" /> Log care
          </Link>
          <Link href={`/staff/residents/${r.id}/history`} className="flex flex-col items-center gap-1 rounded-xl border border-slate-200 text-slate-700 text-[11px] font-bold py-2">
            <History className="w-4 h-4" /> History
          </Link>
          <Link href={`/staff/fast-check?resident=${r.id}`} className="flex flex-col items-center gap-1 rounded-xl border border-red-200 text-red-700 text-[11px] font-bold py-2">
            <Brain className="w-4 h-4" /> Stroke
          </Link>
        </div>
      )}
    </div>
  );
}

export default function StaffWardsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [wards, setWards] = useState<Ward[]>([]);
  const [wardId, setWardId] = useState<string>("");
  const [loggedToday, setLoggedToday] = useState<Set<string>>(new Set());
  const [falls, setFalls] = useState<Set<string>>(new Set());
  const [alertCounts, setAlertCounts] = useState<Map<string, number>>(new Map());
  const [ew, setEw] = useState<Map<string, EwStatus>>(new Map());
  const [openBed, setOpenBed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(async () => {
    const supabase = createClient();
    const [logs, fallRows, alertRows] = await Promise.all([
      supabase.from("care_logs_demo").select("resident_id").gte("created_at", startOfTodayISO()),
      supabase.from("fall_events").select("resident_id").in("status", ["unresolved", "active"]),
      supabase.from("behavior_alerts").select("resident_id").eq("resolved", false),
    ]);
    setLoggedToday(new Set((logs.data ?? []).map((l) => l.resident_id as string)));
    setFalls(new Set((fallRows.data ?? []).map((f) => f.resident_id as string).filter(Boolean)));
    const counts = new Map<string, number>();
    for (const a of alertRows.data ?? []) {
      const id = a.resident_id as string;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    setAlertCounts(counts);
    // Early Warning status is helpful but optional: never block the map on it.
    try {
      const res = await fetch("/api/early-warning", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setEw(new Map((json.report?.residents ?? []).map((r: { resident_id: string; status: EwStatus }) => [r.resident_id, r.status])));
      }
    } catch {
      /* offline: show the map without Early Warning chips */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      const res = await loadWards(supabase);
      if (cancelled) return;
      setWards(res.wards);
      setError(res.error);
      setWardId(res.wards[0]?.id ?? "");
      await loadStatus();
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router, loadStatus]);

  const ward = wards.find((w) => w.id === wardId) ?? null;
  const occupied = useMemo(() => ward?.beds.filter((b) => b.resident) ?? [], [ward]);
  const nextUnlogged = occupied.find((b) => !loggedToday.has(b.resident!.id));

  const refresh = async () => {
    setRefreshing(true);
    await loadStatus();
    setRefreshing(false);
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const half = ward ? Math.ceil(ward.beds.length / 2) : 0;
  const topRow = ward?.beds.slice(0, half) ?? [];
  const bottomRow = ward?.beds.slice(half) ?? [];
  const bathroom = ward?.sharedZones.find((z) => z.kind === "bathroom");
  const walkway = ward?.sharedZones.find((z) => z.kind === "walkway");
  const loggedCount = occupied.filter((b) => loggedToday.has(b.resident!.id)).length;

  const card = (bed: Bed) => (
    <BedCard
      key={bed.id}
      bed={bed}
      logged={!!bed.resident && loggedToday.has(bed.resident.id)}
      fall={!!bed.resident && falls.has(bed.resident.id)}
      alerts={bed.resident ? alertCounts.get(bed.resident.id) ?? 0 : 0}
      ew={bed.resident ? ew.get(bed.resident.id) : undefined}
      open={openBed === bed.id}
      onToggle={() => setOpenBed((o) => (o === bed.id ? null : bed.id))}
    />
  );

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-slate-900">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/staff/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-[#357366] text-white">
            <BedDouble className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold leading-tight">Wards</h1>
            <p className="text-[11px] text-slate-500 hidden sm:block">Tap a bed, or scan its QR tag with the phone camera</p>
          </div>
          <button onClick={refresh} className="ml-auto p-2 rounded-xl border border-slate-200 bg-white" aria-label="Refresh">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
        {wards.length > 1 && (
          <div className="max-w-5xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto">
            {wards.map((w) => (
              <button
                key={w.id}
                onClick={() => {
                  setWardId(w.id);
                  setOpenBed(null);
                }}
                aria-pressed={w.id === wardId}
                className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold border ${w.id === wardId ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}
              >
                {w.name}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">{error}</p>}
        {!ward ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            No wards set up yet. An admin can add them under <strong>Wards &amp; beds</strong>.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 bg-white rounded-2xl border border-slate-100 px-4 py-3">
              <div>
                <div className="text-xs text-slate-500">Logged today</div>
                <div className="text-xl font-black">
                  {loggedCount}/{occupied.length}
                </div>
              </div>
              <div className="h-2 flex-1 min-w-[120px] rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${occupied.length ? (loggedCount / occupied.length) * 100 : 0}%` }} />
              </div>
              {nextUnlogged ? (
                <Link
                  href={`/staff/residents/${nextUnlogged.resident!.id}/log`}
                  className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2.5 rounded-xl bg-[#357366] text-white"
                >
                  <ClipboardPlus className="w-4 h-4" /> Next: {nextUnlogged.label} · {nextUnlogged.resident!.full_name.split(" ")[0]}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                  <Check className="w-4 h-4" /> Round complete
                </span>
              )}
            </div>

            {/* Ward floor plan */}
            <section className="bg-white rounded-3xl border border-slate-100 p-4 shadow-xs">
              <div className="grid gap-3 lg:grid-cols-[1fr_150px]">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{topRow.map(card)}</div>
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500 flex items-center gap-2">
                    <span className="font-semibold">Aisle</span>
                    {walkway && (
                      <span className="inline-flex items-center gap-1">
                        <Radar className="w-3 h-3 text-indigo-500" /> {DEVICE_LABEL[walkway.device_type]}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{bottomRow.map(card)}</div>
                </div>
                <div className="rounded-2xl border-2 border-slate-200 bg-sky-50/50 p-3 flex lg:flex-col items-center justify-center gap-2 text-center">
                  <ShowerHead className="w-6 h-6 text-sky-600" />
                  <div>
                    <div className="text-sm font-bold">Shared bathroom</div>
                    {bathroom && (
                      <div className="text-[11px] text-indigo-700 inline-flex items-center gap-1">
                        <Radar className="w-3 h-3" /> {DEVICE_LABEL[bathroom.device_type]}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <p className="text-xs text-slate-500 flex items-center gap-1.5">
              <QrIcon className="w-3.5 h-3.5" /> Each bed has a QR tag. Scanning it with the phone camera opens that resident&apos;s care log directly.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
