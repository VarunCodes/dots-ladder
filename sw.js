// Service worker: network-first for every file, so the page is always the latest
// deploy when online and the last copy seen when offline.
const CACHE = "dots-ladder-v1";

// Everything the page needs to open offline. Paths are relative to this file.
const PRECACHE = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "app/app.js",
  "app/dom.js",
  "app/events.js",
  "app/log.js",
  "app/ladder.js",
  "app/store.js",
  "app/derive.js",
  "app/chart.js",
  "app/attempts.js",
  "app/meet.js",
  "app/popup.js",
  "app/progress.js",
  "app/scoring.js",
  "app/style.css",
  "data/rungs.json",
  "fonts/barlow-400.woff2",
  "fonts/barlow-500.woff2",
  "fonts/barlow-600.woff2",
  "fonts/barlow-condensed-500.woff2",
  "fonts/barlow-condensed-600.woff2",
  "fonts/barlow-condensed-700.woff2",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request, event));
});

async function networkFirst(request, event) {
  const cache = await caches.open(CACHE);
  try {
    // "no-cache" revalidates with the server, so the browser's HTTP cache can't serve a stale deploy.
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true })
      ?? (request.mode === "navigate" ? await cache.match("./") : undefined);
    if (cached) return cached;
    throw error;
  }
}
