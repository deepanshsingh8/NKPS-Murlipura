// NKPS CMS service worker.
//
// Deliberately minimal. It caches ONLY the app shell (the offline fallback page
// and icons) — never API responses or authenticated HTML. Non-navigation
// requests pass straight through untouched, so nothing authenticated is cached.
//
// Bump CACHE_VERSION to invalidate the shell on the next deploy.

const CACHE_VERSION = "nkps-cms-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle top-level navigations. Everything else goes straight to the
  // network so nothing authenticated is ever cached.
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL, { ignoreSearch: true }).then(
        (cached) =>
          cached ??
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    ),
  );
});

// Let the page trigger an immediate activation of a waiting worker (see
// PWARegister's "Reload" toast).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// --- Phase 3 (push notifications) hooks, intentionally inert for now ---------
self.addEventListener("push", () => {
  // No-op until push is implemented. See the PWA plan, Phase 3.
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
});
