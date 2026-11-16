"use client";

/**
 * QR code rendered as an SVG (crisp when printed, no images or network).
 * Uses the dependency-free qrcode-generator library for the encoding.
 */

import qrcode from "qrcode-generator";
import { useMemo } from "react";

export default function QrCode({
  value,
  size = 160,
  label,
}: {
  value: string;
  size?: number;
  label?: string;
}) {
  const { count, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
      }
    }
    return { count: n, path: d };
  }, [value]);

  const quiet = 4; // standard quiet zone, in modules
  const total = count + quiet * 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label ?? `QR code for ${value}`}
    >
      <rect x={-quiet} y={-quiet} width={total} height={total} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
