/**
 * Dev-only helper for QR bed tags: returns this computer's Wi-Fi/LAN address
 * so tags printed while running locally point at an address a phone on the
 * same network can open (instead of "localhost", which on a phone means the
 * phone itself). Returns 404 in production.
 */

import { networkInterfaces } from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const VIRTUAL = /vmware|virtualbox|vbox|vethernet|hyper-v|docker|wsl|loopback|tailscale|zerotier|bluetooth/i;
const PREFERRED = /wi-?fi|wlan|wireless|^en\d|^eth|ethernet/i;

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const url = new URL(request.url);
  const port = url.port;
  // Keep https when the dev server runs with --experimental-https
  // (needed for the phone fall detector's motion sensor).
  const proto = url.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https" ? "https" : "http";
  const found: { name: string; address: string }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) found.push({ name, address: a.address });
    }
  }
  found.sort((a, b) => Number(PREFERRED.test(b.name)) - Number(PREFERRED.test(a.name)));
  const origins = found.map((f) => `${proto}://${f.address}${port ? `:${port}` : ""}`);
  return NextResponse.json({ origins });
}
