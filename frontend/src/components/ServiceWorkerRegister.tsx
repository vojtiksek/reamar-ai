"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js on mount (production only).
 *
 * The SW precaches the app shell + static assets so cold starts are instant
 * when launched as a PWA from the home screen. API calls are never cached
 * — always fresh from backend.
 *
 * When a new SW is detected, it activates immediately (skipWaiting) so the
 * user doesn't get stuck on an old build.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // If a waiting worker is already there, activate it.
        if (reg.waiting) {
          reg.waiting.postMessage("SKIP_WAITING");
        }

        // Catch updates that arrive while the page is open.
        reg.addEventListener("updatefound", () => {
          const incoming = reg.installing;
          if (!incoming) return;
          incoming.addEventListener("statechange", () => {
            if (incoming.state === "installed" && navigator.serviceWorker.controller) {
              incoming.postMessage("SKIP_WAITING");
            }
          });
        });
      } catch (err) {
        // Non-fatal: app still works without SW.
        // eslint-disable-next-line no-console
        console.warn("[SW] registration failed", err);
      }
    };

    if (document.readyState === "complete") {
      void register();
    } else {
      const onLoad = () => void register();
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
