import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev only: let phones on the same Wi-Fi / hotspot open the dev server
  // (e.g. after scanning a QR bed tag that points at http://192.168.x.x:3000).
  // Without this, Next.js blocks the page's scripts for non-localhost origins
  // and the bed page hangs on "Opening this bed…".
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "tmtouqjgkteghxypirng.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
