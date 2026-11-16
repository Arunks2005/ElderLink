/**
 * Ward / bed / sensor-zone data for shared wards (browser side, RLS-scoped).
 */

import type { createClient } from "@/lib/supabase/client";

type Client = ReturnType<typeof createClient>;

export type Zone = {
  id: string;
  ward_id: string;
  bed_id: string | null;
  kind: "bed" | "bathroom" | "walkway";
  label: string;
  device_type: "bed_mat" | "mmwave_radar" | "presence_radar" | "pir";
  device_id: string | null;
};

export type Bed = {
  id: string;
  ward_id: string;
  label: string;
  position: number;
  resident_id: string | null;
  qr_token: string;
  resident: { id: string; full_name: string; photo_url: string | null; status: string | null } | null;
  zones: Zone[];
};

export type Ward = {
  id: string;
  name: string;
  floor: string | null;
  notes: string | null;
  beds: Bed[];
  sharedZones: Zone[];
};

export const DEVICE_LABEL: Record<Zone["device_type"], string> = {
  bed_mat: "Bed-exit mat",
  mmwave_radar: "60 GHz fall radar",
  presence_radar: "24 GHz presence radar",
  pir: "PIR motion sensor",
};

/** localStorage key: a bed QR scanned before signing in, reopened after login. */
export const PENDING_BED_KEY = "elderlink_pending_bed";

/** Bed tags encode `${origin}/b/${token}`; scanning opens that bed's resident. */
export function bedUrl(origin: string, token: string) {
  return `${origin.replace(/\/+$/, "")}/b/${token}`;
}

export async function loadWards(supabase: Client): Promise<{ wards: Ward[]; error: string | null }> {
  const [w, b, z] = await Promise.all([
    supabase.from("wards").select("id, name, floor, notes").order("name"),
    supabase
      .from("beds")
      .select("id, ward_id, label, position, resident_id, qr_token, resident:residents(id, full_name, photo_url, status)")
      .order("position"),
    supabase.from("sensor_zones").select("id, ward_id, bed_id, kind, label, device_type, device_id").order("label"),
  ]);
  const error = w.error?.message ?? b.error?.message ?? z.error?.message ?? null;
  if (error) return { wards: [], error };

  const zones = (z.data ?? []) as Zone[];
  const beds = ((b.data ?? []) as unknown as (Omit<Bed, "zones" | "resident"> & { resident: Bed["resident"] | Bed["resident"][] })[]).map(
    (bed) => ({
      ...bed,
      resident: Array.isArray(bed.resident) ? bed.resident[0] ?? null : bed.resident,
      zones: zones.filter((zz) => zz.bed_id === bed.id),
    })
  );

  const wards: Ward[] = ((w.data ?? []) as Omit<Ward, "beds" | "sharedZones">[]).map((ward) => ({
    ...ward,
    beds: beds.filter((bed) => bed.ward_id === ward.id).sort((a, c) => a.position - c.position),
    sharedZones: zones.filter((zz) => zz.ward_id === ward.id && !zz.bed_id),
  }));
  return { wards, error: null };
}
