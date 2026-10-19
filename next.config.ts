import type { NextConfig } from "next";

// Every screen is per-user and protected by Row Level Security, so nothing is
// prerendered or cached: Cache Components stays off and pages render per request.
const nextConfig: NextConfig = {
  // The WhatsApp library and its crypto are loaded by Node as they are, not bundled.
  serverExternalPackages: ["@whiskeysockets/baileys", "libsignal", "pino", "sharp", "qrcode"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
