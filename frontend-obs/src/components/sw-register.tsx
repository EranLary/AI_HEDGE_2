"use client";

import { useEffect } from "react";

// Registers the cold-boot warming service worker. Production only —
// keeping it off in dev avoids dev-server reload weirdness, and previews
// don't need the warming UX since they're not the prod cold-start path.
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const url = "/sw.js";
    navigator.serviceWorker.register(url).catch(() => {
      // Registration failures are non-fatal — the app still works,
      // cold starts just hang as they did before.
    });
  }, []);

  return null;
}
