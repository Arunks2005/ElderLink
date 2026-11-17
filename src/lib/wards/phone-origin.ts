"use client";

/**
 * The site address to put in QR codes. On a deployed site this is just the
 * current origin. When running locally, "localhost" in a QR code would mean
 * the phone itself, so use this computer's Wi-Fi address instead (dev only).
 */

import { useEffect, useState } from "react";

export const LOCALHOST_RE = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/;

export function usePhoneOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    let cancelled = false;
    const here = window.location.origin;
    void (async () => {
      if (!LOCALHOST_RE.test(here)) {
        setOrigin(here);
        return;
      }
      try {
        const r = await fetch("/api/dev/network-address", { cache: "no-store" });
        const j = r.ok ? ((await r.json()) as { origins?: string[] }) : {};
        if (!cancelled) setOrigin(j.origins?.[0] ?? here);
      } catch {
        if (!cancelled) setOrigin(here);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return origin;
}
