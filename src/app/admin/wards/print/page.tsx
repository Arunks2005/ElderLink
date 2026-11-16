"use client";

/**
 * Printable QR bed tags. Each tag encodes {site}/b/{token}; scanning it with
 * any phone camera opens that bed's resident in ElderLink (staff login
 * still required). Set the site address to your HTTPS deployment so staff
 * phones can reach it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import QrCode from "@/components/QrCode";
import { bedUrl, loadWards, type Ward } from "@/lib/wards/wards";

const ORIGIN_KEY = "elderlink_qr_site";

export default function PrintBedTagsPage() {
  const router = useRouter();
  const [wards, setWards] = useState<Ward[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [onlyWard, setOnlyWard] = useState<string | null>(null);

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
      let saved = "";
      try {
        saved = localStorage.getItem(ORIGIN_KEY) ?? "";
      } catch {
        /* storage unavailable */
      }
      setOrigin(saved || window.location.origin);
      setOnlyWard(new URLSearchParams(window.location.search).get("ward"));
      setWards(res.wards);
      setError(res.error);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const saveOrigin = (v: string) => {
    setOrigin(v);
    try {
      localStorage.setItem(ORIGIN_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };

  if (!wards) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#4F9C8B]" />
      </div>
    );
  }

  const shown = wards.filter((w) => !onlyWard || w.id === onlyWard);
  const isLocal = /localhost|127\.0\.0\.1|^http:\/\/192\.168\./.test(origin);

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="print:hidden sticky top-0 bg-white border-b border-slate-100 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
          <Link href="/admin/wards" className="p-2 rounded-xl hover:bg-slate-100" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <h1 className="font-bold">QR bed tags</h1>
          <label className="text-xs text-slate-600 flex items-center gap-2 flex-1 min-w-[260px]">
            Site address in QR
            <input
              value={origin}
              onChange={(e) => saveOrigin(e.target.value.trim())}
              className="flex-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              aria-label="Site address encoded in the QR codes"
            />
          </label>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-sm font-bold px-4 py-2 rounded-xl bg-slate-900 text-white">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
        {isLocal && (
          <p className="max-w-5xl mx-auto px-4 pb-3 text-xs text-amber-700">
            This address only works on this computer or network. For real tags, enter your HTTPS site (e.g. your Vercel
            address) so staff phones can open it anywhere.
          </p>
        )}
        {error && <p className="max-w-5xl mx-auto px-4 pb-3 text-xs text-red-700">{error}</p>}
      </div>

      <main className="max-w-5xl mx-auto px-4 py-6 print:p-0">
        {shown.map((ward) => (
          <section key={ward.id} className="mb-8 break-inside-avoid">
            <h2 className="text-lg font-black mb-3 print:mb-2">{ward.name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 print:grid-cols-3 print:gap-3">
              {ward.beds.map((bed) => (
                <div key={bed.id} className="border-2 border-slate-900 rounded-2xl p-3 flex flex-col items-center text-center break-inside-avoid">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">{ward.name}</div>
                  <div className="text-2xl font-black leading-tight">{bed.label}</div>
                  <div className="text-sm font-semibold text-slate-700 mb-2 min-h-[1.25rem]">{bed.resident?.full_name ?? "Empty bed"}</div>
                  <QrCode value={bedUrl(origin, bed.qr_token)} size={150} label={`QR tag for ${ward.name} ${bed.label}`} />
                  <div className="text-[10px] text-slate-500 mt-2 leading-tight">
                    Scan with the phone camera to open the care log
                    <br />
                    ElderLink · {bed.qr_token.slice(0, 6)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
