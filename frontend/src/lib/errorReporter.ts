/**
 * Client-side error reporter — sends runtime errors and failed fetches
 * to the backend so they show up in /admin/errors.
 *
 * Captures:
 *   - window.onerror              (synchronous JS errors)
 *   - unhandledrejection          (uncaught Promise rejections)
 *   - fetch() failures            (non-2xx responses + network errors)
 *
 * Every captured error is ALSO mirrored into localStorage so /admin/errors
 * can display recent issues even when the backend / database is down (which
 * is exactly when the user wants to see what broke).
 *
 * All sends are best-effort (sendBeacon → fetch fallback) and never throw.
 * A simple per-minute rate limit prevents floods.
 */

import { API_BASE } from "./api";

type ClientErrorPayload = {
  message: string;
  source?: "window" | "unhandledrejection" | "fetch" | "react";
  stack?: string;
  url?: string;
  method?: string;
  status?: number;
  user_agent?: string;
  extra?: Record<string, unknown>;
};

export type LocalErrorRecord = ClientErrorPayload & {
  id: string;
  ts: string;
};

const RATE_LIMIT_PER_MIN = 50;
const LOCAL_STORAGE_KEY = "reamar_local_errors";
const LOCAL_STORAGE_MAX = 100;

let recentTimestamps: number[] = [];
let installed = false;

function rateLimited(): boolean {
  const now = Date.now();
  recentTimestamps = recentTimestamps.filter((t) => now - t < 60_000);
  if (recentTimestamps.length >= RATE_LIMIT_PER_MIN) return true;
  recentTimestamps.push(now);
  return false;
}

function appendLocal(payload: ClientErrorPayload): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    const arr: LocalErrorRecord[] = raw ? JSON.parse(raw) : [];
    arr.push({
      ...payload,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: new Date().toISOString(),
    });
    while (arr.length > LOCAL_STORAGE_MAX) arr.shift();
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // localStorage may be full or disabled — ignore
  }
}

export function readLocalErrors(): LocalErrorRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function clearLocalErrors(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function send(payload: ClientErrorPayload): void {
  if (rateLimited()) return;

  // Always mirror locally — survives backend/DB outage so the user can still
  // see what broke from /admin/errors local fallback.
  appendLocal(payload);

  const url = `${API_BASE}/admin/client-errors`;
  const body = JSON.stringify({
    ...payload,
    user_agent: payload.user_agent ?? (typeof navigator !== "undefined" ? navigator.userAgent : undefined),
    url: payload.url ?? (typeof window !== "undefined" ? window.location.href : undefined),
  });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/json" });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never let the reporter throw
  }
}

/** Public — call from React error boundaries. */
export function reportClientError(
  message: string,
  opts: Omit<ClientErrorPayload, "message"> = {},
): void {
  send({ message, source: opts.source ?? "react", ...opts });
}

export function installErrorReporter(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    // Skip resource load errors (img, script) — too noisy and we already see them.
    if (event.message === "Script error." && !event.error) return;
    send({
      message: event.message || "(window error)",
      source: "window",
      stack: event.error?.stack,
      extra: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    let message: string;
    let stack: string | undefined;
    if (reason instanceof Error) {
      message = `${reason.name}: ${reason.message}`;
      stack = reason.stack;
    } else if (typeof reason === "string") {
      message = reason;
    } else {
      try {
        message = JSON.stringify(reason);
      } catch {
        message = "(unknown rejection)";
      }
    }
    send({ message, source: "unhandledrejection", stack });
  });

  // Wrap fetch to capture non-2xx and network failures.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    let urlStr: string;
    if (typeof input === "string") urlStr = input;
    else if (input instanceof URL) urlStr = input.toString();
    else urlStr = input.url;

    // Don't loop: never report errors from the reporter endpoint itself.
    const isReporter = urlStr.includes("/admin/client-errors");
    // Only report failures from our own backend — skip third-party services
    // (Supabase auth, OSM tiles, GA, etc.) which we don't control.
    const isOurBackend = isOwnBackend(urlStr);

    try {
      const res = await originalFetch(input, init);
      if (!isReporter && isOurBackend && res.status >= 500) {
        // Clone and read text best-effort for the report body.
        let bodySnippet = "";
        try {
          const cloned = res.clone();
          bodySnippet = (await cloned.text()).slice(0, 500);
        } catch {
          // ignore
        }
        send({
          message: `HTTP ${res.status} ${res.statusText || ""} on ${method} ${shortPath(urlStr)}`.trim(),
          source: "fetch",
          method,
          status: res.status,
          url: urlStr,
          extra: bodySnippet ? { body: bodySnippet } : undefined,
        });
      }
      return res;
    } catch (err: unknown) {
      // AbortError = záměrné cancellation (debounce filtrů, unmount komponenty,
      // navigace), ne bug. Nezahlcovat /admin/errors.
      const isAbort = err instanceof DOMException
        ? err.name === "AbortError"
        : (err as { name?: string } | null)?.name === "AbortError";
      // Next.js RSC prefetch — když user otevře recs list, Next.js si stahuje
      // payload každého rozkliknutelného unit detailu. Při rychlé navigaci nebo
      // filter změně browser tyhle prefetches aborts a Safari to hlásí jako
      // generic "TypeError: Load failed" místo AbortError. Není to bug.
      const isRscPrefetch = urlStr.includes("_rsc=") || urlStr.includes("?_rsc");
      if (!isReporter && isOurBackend && !isAbort && !isRscPrefetch) {
        const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        send({
          message: `Network error on ${method} ${shortPath(urlStr)}: ${message}`,
          source: "fetch",
          method,
          url: urlStr,
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
      throw err;
    }
  };
}

function isOwnBackend(url: string): boolean {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://x");
    // Same origin = always our app (Next.js routes).
    if (typeof window !== "undefined" && u.origin === window.location.origin) return true;
    // Match the configured API base (Railway backend URL).
    if (API_BASE) {
      try {
        const apiUrl = new URL(API_BASE);
        if (u.origin === apiUrl.origin) return true;
      } catch {
        // ignore
      }
    }
    return false;
  } catch {
    return false;
  }
}

function shortPath(url: string): string {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://x");
    return u.pathname + (u.search ? u.search.slice(0, 200) : "");
  } catch {
    return url.slice(0, 200);
  }
}
