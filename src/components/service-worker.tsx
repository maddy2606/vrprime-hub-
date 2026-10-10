"use client";

import { useEffect } from "react";
import { safeError } from "@/lib/redact";

/** Registers the service worker that makes the app installable (and, from Phase 2, receives push). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.error("Service worker registration failed", safeError(error)));
  }, []);
  return null;
}
