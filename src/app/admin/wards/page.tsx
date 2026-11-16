"use client";

/**
 * Admin: wards, beds, resident placement, sensor zones and QR bed tags.
 * Writes are admin-only (row-level security); this page also checks it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BedDouble, Loader2, Plus, Printer, QrCode as QrIcon, Radar, Trash2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { DEVICE_LABEL, loadWards, type Ward } from "@/lib/wards/wards";

type Resident = { id: string; full_name: string };

export default function AdminWardsPage() {
  const router = useRouter();
  const [state, setState] = useState<"loading" | "denied" | "ready">("loading");
  const [wards, setWards] = useState<Ward[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [newName, setNewName] = useState("");
  const [newBeds, setNewBeds] = useState(6);
  const [withSensors, setWithSensors] = useState(true);

  const reload = useCallback(async () => {
    const supabase = createClient();
    const [{ wards: w, error }, { data: rows }] = await Promise.all([
      loadWards(supabase),
      supabase.from("residents").select("id, full_name").eq("status", "active").order("full_name"),
    ]);
    if (error) setMsg({ text: `Could not load wards: ${error}`, ok: false });
    setWards(w);
    setResidents((rows as Resident[]) ?? []);
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
      const { data: admin } = await supabase.from("admins").select("id").eq("id", data.user.id).maybeSingle();
      if (cancelled) return;
      if (!admin) {
        setState("denied");
        return;
      }
      await reload();
      setState("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, reload]);

  const act = async (fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ text: await fn(), ok: true });
      await reload();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : "Something went wrong.", ok: false });
    } finally {
      setBusy(false);
    }
  };

  const createWard = () =>
    act(async () => {
      const name = newName.trim();
      if (!name) throw new Error("Give the ward a name.");
      const n = Math.max(1, Math.min(30, newBeds));
      const supabase = createClient();
      const { data: ward, error } = await supabase.from("wards").insert({ name }).select("id").single();
      if (error) throw new Error(error.message);
      const { data: beds, error: bErr } = await supabase
        .from("beds")
        .insert(Array.from({ length: n }, (_, i) => ({ ward_id: ward.id, label: `Bed ${i + 1}`, position: i + 1 })))
        .select("id, position");
      if (bErr) throw new Error(bErr.message);
      if (withSensors) {
        const short = name.replace(/\s+/g, "").slice(0, 8).toUpperCase();
        const zones = [
          ...(beds ?? []).map((b) => ({
            ward_id: ward.id,
            bed_id: b.id,
            kind: "bed",
            label: `Bed ${b.position} mat`,
            device_type: "bed_mat",
            device_id: `BEDMAT-${short}-${b.position}`,
          })),
          { ward_id: ward.id, bed_id: null, kind: "bathroom", label: "Shared bathroom", device_type: "mmwave_radar", device_id: `RADAR60-BATH-${short}` },
          { ward_id: ward.id, bed_id: null, kind: "walkway", label: "Walkway between beds", device_type: "presence_radar", device_id: `RADAR24-WALK-${short}` },
        ];
        const { error: zErr } = await supabase.from("sensor_zones").insert(zones);
        if (zErr) throw new Error(zErr.message);
      }
      setNewName("");
      return `${name} created with ${n} beds${withSensors ? " and sensor zones" : ""}.`;
    });

  const addBed = (ward: Ward) =>
    act(async () => {
      const position = Math.max(0, ...ward.beds.map((b) => b.position)) + 1;
      const supabase = createClient();
      const { data: bed, error } = await supabase
        .from("beds")
        .insert({ ward_id: ward.id, label: `Bed ${position}`, position })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      await supabase.from("sensor_zones").insert({
        ward_id: ward.id,
        bed_id: bed.id,
        kind: "bed",
        label: `Bed ${position} mat`,
        device_type: "bed_mat",
        device_id: `BEDMAT-${ward.name.replace(/\s+/g, "").slice(0, 8).toUpperCase()}-${position}`,
      });
      return `Bed ${position} added to ${ward.name}.`;
    });

  const deleteBed = (ward: Ward, bedId: string, label: string) => {
    if (!window.confirm(`Remove ${label} from ${ward.name}? Its QR tag will stop working.`)) return;
    void act(async () => {
      const { error } = await createClient().from("beds").delete().eq("id", bedId);
      if (error) throw new Error(error.message);
      return `${label} removed.`;
    });
  };

  const deleteWard = (ward: Ward) => {
    if (!window.confirm(`Delete ${ward.name} and its ${ward.beds.length} beds? Residents stay in the system, unassigned.`)) return;
    void act(async () => {
      const { error } = await createClient().from("wards").delete().eq("id", ward.id);
      if (error) throw new Error(error.message);
      return `${ward.name} deleted.`;
    });
  };

  const assign = (bedId: string, residentId: string) =>
    act(async () => {
      const supabase = createClient();
      if (residentId) {
        // A resident can only be in one bed: free their old bed first.
        const { error: freeErr } = await supabase.from("beds").update({ resident_id: null }).eq("resident_id", residentId).neq("id", bedId);
        if (freeErr) throw new Error(freeErr.message);
      }
      const { error } = await supabase.from("beds").update({ resident_id: residentId || null }).eq("id", bedId);
      if (error) throw new Error(error.message);
      const name = residents.find((r) => r.id === residentId)?.full_name;
      return residentId ? `${name} assigned.` : "Bed is now empty.";
    });

  if (state === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8]">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] p-6 text-center">
        <div>
          <p className="font-bold text-slate-900">Admins only</p>
          <p className="text-sm text-slate-500 mt-1">Ask an administrator to change wards and beds.</p>
          <Link href="/staff/dashboard" className="inline-block mt-4 text-sm font-semibold text-[#357366] underline">
            Open the staff dashboard instead
          </Link>
        </div>
      </div>
    );
  }

  const placed = new Set(wards.flatMap((w) => w.beds.map((b) => b.resident_id)).filter(Boolean));
  const unplaced = residents.filter((r) => !placed.has(r.id));

  return (
    <div className="min-h-screen bg-[#F6F7FB] text-slate-900">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-2">
          <Link href="/admin/dashboard" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back to admin dashboard">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="p-2 rounded-xl bg-emerald-600 text-white">
            <BedDouble className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold leading-tight">Wards &amp; beds</h1>
            <p className="text-[11px] text-slate-500">Shared wards, bed placement, sensors and QR bed tags</p>
          </div>
          <Link
            href="/admin/wards/print"
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-slate-900 text-white"
          >
            <Printer className="w-3.5 h-3.5" /> Print all QR tags
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-5 space-y-4">
        {msg && (
          <div role="status" className={`rounded-xl border px-4 py-2.5 text-sm ${msg.ok ? "bg-emerald-50 border-emerald-200 text-emerald-900" : "bg-red-50 border-red-200 text-red-800"}`}>
            {msg.text}
          </div>
        )}

        {unplaced.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
            <Users className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>{unplaced.length} resident{unplaced.length === 1 ? "" : "s"} without a bed:</strong>{" "}
              {unplaced.map((r) => r.full_name).join(", ")}
            </span>
          </div>
        )}

        {wards.map((ward) => (
          <section key={ward.id} className="bg-white rounded-3xl border border-slate-100 shadow-xs overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 px-5 py-4 border-b border-slate-100">
              <h2 className="text-lg font-black">{ward.name}</h2>
              <span className="text-xs text-slate-500">
                {ward.beds.filter((b) => b.resident_id).length}/{ward.beds.length} beds occupied
                {ward.floor ? ` · ${ward.floor}` : ""}
              </span>
              <div className="ml-auto flex gap-2">
                <Link
                  href={`/admin/wards/print?ward=${ward.id}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50"
                >
                  <QrIcon className="w-3.5 h-3.5" /> QR tags
                </Link>
                <button
                  onClick={() => addBed(ward)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" /> Bed
                </button>
                <button
                  onClick={() => deleteWard(ward)}
                  disabled={busy}
                  className="p-2 rounded-xl border border-slate-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                  aria-label={`Delete ${ward.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <ul className="divide-y divide-slate-100">
              {ward.beds.map((bed) => (
                <li key={bed.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <span className="w-16 font-bold text-sm">{bed.label}</span>
                  <select
                    value={bed.resident_id ?? ""}
                    onChange={(e) => assign(bed.id, e.target.value)}
                    disabled={busy}
                    className="flex-1 min-w-[200px] border border-slate-200 rounded-xl px-3 py-2 text-sm bg-white"
                    aria-label={`Resident in ${ward.name} ${bed.label}`}
                  >
                    <option value="">Empty bed</option>
                    {bed.resident && <option value={bed.resident.id}>{bed.resident.full_name}</option>}
                    {unplaced.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11px] text-slate-500">
                    {bed.zones.map((z) => `${DEVICE_LABEL[z.device_type]}${z.device_id ? ` (${z.device_id})` : ""}`).join(", ") || "No sensor"}
                  </span>
                  <button
                    onClick={() => deleteBed(ward, bed.id, bed.label)}
                    disabled={busy}
                    className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                    aria-label={`Remove ${bed.label}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>

            {ward.sharedZones.length > 0 && (
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-2 text-xs">
                <Radar className="w-3.5 h-3.5 text-indigo-600" />
                {ward.sharedZones.map((z) => (
                  <span key={z.id} className="px-2 py-1 rounded-lg bg-white border border-slate-200">
                    {z.label}: {DEVICE_LABEL[z.device_type]}
                    {z.device_id ? ` (${z.device_id})` : ""}
                  </span>
                ))}
              </div>
            )}
          </section>
        ))}

        <section className="bg-white rounded-3xl border border-slate-100 shadow-xs p-5 space-y-3">
          <h2 className="font-bold flex items-center gap-2">
            <Plus className="w-4 h-4" /> New ward
          </h2>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Ward C (Women)"
              className="flex-1 min-w-[200px] border border-slate-200 rounded-xl px-3 py-2 text-sm"
              aria-label="Ward name"
            />
            <label className="text-sm inline-flex items-center gap-2">
              Beds
              <input
                type="number"
                min={1}
                max={30}
                value={newBeds}
                onChange={(e) => setNewBeds(Number(e.target.value))}
                className="w-20 border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs inline-flex items-center gap-1.5">
              <input type="checkbox" checked={withSensors} onChange={(e) => setWithSensors(e.target.checked)} />
              Add bed mats + bathroom radar + walkway sensor
            </label>
            <button
              onClick={createWard}
              disabled={busy || !newName.trim()}
              className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl bg-emerald-600 text-white disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create ward
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
