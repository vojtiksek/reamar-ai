// Reamar service worker
// Strategy:
//   - Precache app shell (/, manifest, icons) on install
//   - Static assets (/_next/static/*, /icons/*, fonts): cache-first + stale-while-revalidate
//   - Navigations (HTML): network-first with cached fallback for offline
//   - API calls and cross-origin requests: NEVER cached (pass through)
//
// Bump VERSION to invalidate old caches after a deploy that must not serve stale JS.
// Normally Next.js emits hashed asset URLs so version bump isn't required; keep for safety.

const VERSION = "v1";
const STATIC_CACHE = `reamar-static-${VERSION}`;
const RUNTIME_CACHE = `reamar-runtime-${VERSION}`;
const OFFLINE_URL = "/";

const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (url.pathname.startsWith("/icons/")) return true;
  if (url.pathname === "/manifest.webmanifest") return true;
  return /\.(css|js|woff2?|ttf|otf|eot|png|jpg|jpeg|gif|svg|webp|avif)$/i.test(
    url.pathname,
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Pass-through for API / backend / cross-origin
  if (
    url.pathname.startsWith("/api/") ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Static assets — cache-first with background update (stale-while-revalidate)
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type !== "opaque") {
              cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => cached);
        return cached || networkPromise;
      }),
    );
    return;
  }

  // Navigations — network-first, fallback to cached shell for offline
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match(OFFLINE_URL);
          return (
            shell ||
            new Response(
              "<!doctype html><title>Offline</title><h1>Offline</h1><p>Nedostupné bez připojení.</p>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }),
    );
    return;
  }

  // Other same-origin GETs — network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request)),
  );
});
