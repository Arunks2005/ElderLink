"use client";

/**
 * QR bed tag landing page: /b/{token}.
 * Looks up the bed (staff-only via row-level security) and opens its
 * resident's details page (Log care, Help and SOS are one tap from there). If the phone isn't signed in yet, remembers the bed
 * and continues after sign-in from the staff dashboard.
 */

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BedDouble, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PENDING_BED_KEY } from "@/lib/wards/wards";

type View =
  | { kind: "checking" }
  | { kind: "login" }
  | { kind: "notfound" }
  | { kind: "empty"; ward: string; bed: string };

export default function BedScanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data.user) {
        try {
          localStorage.setItem(PENDING_BED_KEY, token);
        } catch {
          /* storage unavailable */
        }
        setView({ kind: "login" });
        return;
      }
      const { data: bed } = await supabase
        .from("beds")
        .select("label, resident_id, ward:wards(name)")
        .eq("qr_token", token)
        .maybeSingle();
      if (cancelled) return;
      if (!bed) {
        setView({ kind: "notfound" });
        return;
      }
      const wardName = (Array.isArray(bed.ward) ? bed.ward[0]?.name : (bed.ward as { name?: string } | null)?.name) ?? "Ward";
      if (!bed.resident_id) {
        setView({ kind: "empty", ward: wardName, bed: bed.label });
        return;
      }
      router.replace(`/staff/residents/${bed.resident_id}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAF8] p-6">
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 max-w-sm w-full text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-[#EAF4F1] text-[#357366] flex items-center justify-center">
          <BedDouble className="w-6 h-6" />
        </div>
        {view.kind === "checking" && (
          <p className="text-sm text-slate-600 inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Opening this bed…
          </p>
        )}
        {view.kind === "login" && (
          <>
            <p className="font-bold">Sign in to open this bed</p>
            <p className="text-sm text-slate-500">After signing in, ElderLink will open this resident&apos;s page.</p>
            <Link href="/login" className="block bg-[#357366] text-white font-bold py-3 rounded-2xl">
              Staff sign in
            </Link>
          </>
        )}
        {view.kind === "notfound" && (
          <>
            <p className="font-bold">QR tag not recognised</p>
            <p className="text-sm text-slate-500">This bed may have been removed, or your account cannot see wards. Ask an admin to reprint the tag.</p>
            <Link href="/staff/dashboard" className="block border border-slate-200 font-semibold py-3 rounded-2xl">
              Open staff dashboard
            </Link>
          </>
        )}
        {view.kind === "empty" && (
          <>
            <p className="font-bold">
              {view.ward} · {view.bed}
            </p>
            <p className="text-sm text-slate-500">No resident is assigned to this bed.</p>
            <Link href="/staff/dashboard" className="block border border-slate-200 font-semibold py-3 rounded-2xl">
              Open staff dashboard
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
