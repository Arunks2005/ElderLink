"use client";

/**
 * Ward board (staff dashboard, main column).
 *
 * The ward drawn as it is: beds along an aisle with the shared bathroom.
 * Each bed shows whether today's care log is done, an open fall alert and
 * the behaviour-analysis status, and carries the bed's actions: Log care,
 * SOS, request help, resident details. Replaces the separate resident lists
 * and the separate Wards page.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BedDouble,
  Check,
  ClipboardPlus,
  HelpCircle,
  Info,
  Moon,
  QrCode as QrIcon,
  Radar,
  Search,
  ShieldAlert,
  ShowerHead,
  Smartphone,
} from "lucide-react";
import { DEVICE_LABEL, type Bed, type Ward } from "@/lib/wards/wards";

export type BoardResident = { id: string; full_name: string; photo_url: string | null; room_number?: string | null };
type Status = "act" | "watch" | "stable" | "baseline";

const STATUS_CHIP: Partial<Record<Status, { label: string; cls: string }>> = {
  act: { label: "Act today", cls: "bg-red-50 text-red-700 border-red-200" },
  watch: { label: "Watch", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

function BedCard({
  bed,
  logged,
  fall,
  status,
  dim,
  onSos,
  onAssist,
  onDetails,
}: {
  bed: Bed;
  logged: boolean;
  fall: boolean;
  status: Status | undefined;
  dim: boolean;
  onSos: (r: BoardResident) => void;
  onAssist: (r: BoardResident) => void;
  onDetails: (r: BoardResident) => void;
}) {
  const r = bed.resident;
  const chip = status ? STATUS_CHIP[status] : undefined;
  if (!r) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-3 min-h-[132px] flex flex-col">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <BedDouble className="w-4 h-4" /> {bed.label}
        </span>
        <span className="mt-auto text-sm text-slate-300">Empty bed</span>
      </div>
    );
  }
  const resident: BoardResident = { id: r.id, full_name: r.full_name, photo_url: r.photo_url };
  return (
    <div
      className={`rounded-2xl border-2 bg-white p-3 flex flex-col gap-2 transition-opacity ${
        fall ? "border-red-500 ring-2 ring-red-200" : status === "act" ? "border-red-200" : logged ? "border-slate-200" : "border-amber-200"
      } ${dim ? "opacity-30" : ""}`}
    >
      <div className="flex items-center gap-2">
        <BedDouble className="w-4 h-4 text-slate-400" />
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{bed.label}</span>
        {logged ? (
          <span className="ml-auto inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">
            <Check className="w-3 h-3" /> Logged
          </span>
        ) : (
          <span className="ml-auto text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">Not logged</span>
        )}
      </div>
      <button onClick={() => onDetails(resident)} className="text-left font-bold text-slate-900 leading-tight hover:text-[#357366] hover:underline underline-offset-2">
        {r.full_name}
      </button>
      {(fall || chip) && (
        <div className="flex flex-wrap gap-1">
          {fall && (
            <span className="inline-flex items-center gap-1 text-[10px] font-black text-white bg-red-600 px-1.5 py-0.5 rounded-md animate-pulse">
              <AlertTriangle className="w-3 h-3" /> FALL ALERT
            </span>
          )}
          {chip && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${chip.cls}`}>{chip.label}</span>}
        </div>
      )}
      <div className="mt-auto space-y-1.5">
        <Link
          href={`/staff/residents/${r.id}/log`}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#357366] hover:bg-[#2b5e53] text-white text-sm font-bold py-2"
        >
          <ClipboardPlus className="w-4 h-4" /> Log care
        </Link>
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => onSos(resident)}
            className="inline-flex items-center justify-center gap-1 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[11px] font-bold py-1.5"
            aria-label={`SOS for ${r.full_name}`}
          >
            <ShieldAlert className="w-3.5 h-3.5" /> SOS
          </button>
          <button
            onClick={() => onAssist(resident)}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold py-1.5"
            aria-label={`Request help for ${r.full_name}`}
          >
            <HelpCircle className="w-3.5 h-3.5" /> Help
          </button>
          <button
            onClick={() => onDetails(resident)}
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-[11px] font-semibold py-1.5"
            aria-label={`Details for ${r.full_name}`}
          >
            <Info className="w-3.5 h-3.5" /> Details
          </button>
        </div>
      </div>
    </div>
  );
}

export default function WardBoard({
  wards,
  unplaced,
  loggedToday,
  falls,
  statuses,
  onSos,
  onAssist,
  onDetails,
}: {
  wards: Ward[];
  unplaced: BoardResident[];
  loggedToday: Set<string>;
  falls: Set<string>;
  statuses: Map<string, Status>;
  onSos: (r: BoardResident) => void;
  onAssist: (r: BoardResident) => void;
  onDetails: (r: BoardResident) => void;
}) {
  const [wardId, setWardId] = useState<string>(() => wards[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const ward = wards.find((w) => w.id === wardId) ?? wards[0] ?? null;
  const occupied = useMemo(() => ward?.beds.filter((b) => b.resident) ?? [], [ward]);
  const nextUnlogged = occupied.find((b) => !loggedToday.has(b.resident!.id));
  const loggedCount = occupied.filter((b) => loggedToday.has(b.resident!.id)).length;
  const q = search.trim().toLowerCase();

  // Searching jumps to the ward containing the match.
  const onSearch = (v: string) => {
    setSearch(v);
    const s = v.trim().toLowerCase();
    if (!s) return;
    const hit = wards.find((w) => w.beds.some((b) => b.resident?.full_name.toLowerCase().includes(s)));
    if (hit && hit.id !== wardId) setWardId(hit.id);
  };

  const card = (bed: Bed) => (
    <BedCard
      key={bed.id}
      bed={bed}
      logged={!!bed.resident && loggedToday.has(bed.resident.id)}
      fall={!!bed.resident && falls.has(bed.resident.id)}
      status={bed.resident ? statuses.get(bed.resident.id) : undefined}
      dim={!!q && !(bed.resident?.full_name.toLowerCase().includes(q) ?? false)}
      onSos={onSos}
      onAssist={onAssist}
      onDetails={onDetails}
    />
  );

  const bathroom = ward?.sharedZones.find((z) => z.kind === "bathroom");
  const walkway = ward?.sharedZones.find((z) => z.kind === "walkway");
  const alertsInWard = (w: Ward) => w.beds.some((b) => b.resident && (falls.has(b.resident.id) || statuses.get(b.resident.id) === "act"));

  return (
    <section className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-slate-100 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5 overflow-x-auto">
            {wards.map((w) => (
              <button
                key={w.id}
                onClick={() => setWardId(w.id)}
                aria-pressed={w.id === ward?.id}
                className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold border ${
                  w.id === ward?.id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
                }`}
              >
                {w.name}
                <span className="ml-1.5 text-[11px] font-semibold opacity-70">{w.beds.filter((b) => b.resident).length}</span>
                {alertsInWard(w) && <span className="ml-1.5 inline-block w-2 h-2 rounded-full bg-red-500 align-middle" title="Needs attention" />}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Find resident…"
              className="pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-sm w-44 outline-none focus:border-[#4F9C8B]"
              aria-label="Find resident"
            />
          </div>
        </div>

        {ward && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm">
              <span className="font-black text-lg">{loggedCount}/{occupied.length}</span>{" "}
              <span className="text-slate-500">logged today</span>
            </div>
            <div className="h-2 flex-1 min-w-[100px] rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${occupied.length ? (loggedCount / occupied.length) * 100 : 0}%` }} />
            </div>
            {nextUnlogged ? (
              <Link
                href={`/staff/residents/${nextUnlogged.resident!.id}/log`}
                className="inline-flex items-center gap-1.5 text-sm font-bold px-3.5 py-2 rounded-xl bg-[#357366] text-white"
              >
                <ClipboardPlus className="w-4 h-4" /> Next: {nextUnlogged.label} · {nextUnlogged.resident!.full_name.split(" ")[0]}
              </Link>
            ) : occupied.length > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-700">
                <Check className="w-4 h-4" /> Round complete
              </span>
            ) : null}
          </div>
        )}
      </div>

      {!ward ? (
        <p className="p-6 text-sm text-slate-500 text-center">No wards set up yet. An admin can add them under Wards &amp; beds.</p>
      ) : (
        <div className="p-4 space-y-3">
          {/* Even grid: every bed card keeps a usable width and wraps cleanly. */}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">{ward.beds.map(card)}</div>
          {(bathroom || walkway) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] text-slate-600">
              {bathroom && (
                <span className="inline-flex items-center gap-1.5">
                  <ShowerHead className="w-3.5 h-3.5 text-sky-600" /> Shared bathroom ·
                  <Radar className="w-3 h-3 text-indigo-500" /> {DEVICE_LABEL[bathroom.device_type]}
                </span>
              )}
              {walkway && (
                <span className="inline-flex items-center gap-1.5">
                  <Radar className="w-3 h-3 text-indigo-500" /> Aisle · {DEVICE_LABEL[walkway.device_type]}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5">
                <BedDouble className="w-3.5 h-3.5 text-slate-400" /> Bed-exit mat on each bed
              </span>
            </div>
          )}
        </div>
      )}

      {unplaced.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs font-bold text-amber-800 mb-2">Not placed in a ward ({unplaced.length})</p>
          <div className="flex flex-wrap gap-2">
            {unplaced.map((r) => (
              <span key={r.id} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 pl-3 pr-1 py-1 text-sm">
                {r.full_name}
                <Link href={`/staff/residents/${r.id}/log`} className="rounded-lg bg-[#357366] text-white text-xs font-bold px-2 py-1">
                  Log
                </Link>
                <button onClick={() => onSos(r)} className="rounded-lg bg-red-600 text-white text-xs font-bold px-2 py-1">
                  SOS
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <QrIcon className="w-3.5 h-3.5" /> Or scan a bed&apos;s QR tag with the phone camera
        </span>
        <Link href="/staff/night-monitor" className="ml-auto inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">
          <Moon className="w-3.5 h-3.5" /> Ward sensors (simulated)
        </Link>
        <Link href="/fall-detect" className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline">
          <Smartphone className="w-3.5 h-3.5" /> Phone as fall sensor
        </Link>
      </div>
    </section>
  );
}
