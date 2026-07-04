/**
 * Root service worker for the main FibreFlow app (scope '/').
 *
 * Provides: an installable offline shell + a runtime cache — navigations are
 * network-first with an offline-page fallback; a strict allowlist of
 * build/static assets is cache-first. Deliberately NEVER touches the
 * sub-scopes that already own a service worker (/my → sw-my.js,
 * field-stock → sw-stock.js, fleet → sw-fleet.js) nor any non-GET request
 * (mutations go to the network or the app's offline queue).
 */

// Scope-arbitration guard `isReserved` lives in ONE place
// (public/sw-app-guard.js), shared with its unit test. importScripts loads it
// into this SW's global scope so `isReserved(pathname)` is callable in the fetch
// handler below. Service workers can't `import` from src/, so a shared public/
// script that works in both a SW global and a CommonJS require is the DRY way
// to keep a single source of truth (no duplicated prefix lists).
importScripts('/sw-app-guard.js');

const SHELL_CACHE = 'app-shell-v1';
const RUNTIME_CACHE = 'app-runtime-v1';

const SHELL_ASSETS = ['/offline.html', '/manifest.json'];

// Cache-first ONLY for build assets and an explicit public-asset allowlist —
// never per-user or storage-proxied content (e.g. /storage/*), which must not
// be served stale from a shared cache.
const CACHEABLE_PREFIXES = ['/_next/static/', '/icons/', '/assets/'];
const CACHEABLE_PATHS = [
  '/manifest.json', '/offline.html', '/favicon.ico', '/favicon.svg',
  '/favicon-16x16.png', '/apple-touch-icon.png', '/icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((n) => (n.startsWith('app-shell-') || n.startsWith('app-runtime-')) &&
              n !== SHELL_CACHE && n !== RUNTIME_CACHE)
            .map((n) => caches.delete(n))
        )
      ),
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin
  if (isReserved(url.pathname)) return; // hands off — another SW owns this

  // Navigations: network-first, fall back to cache, then the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/offline.html')))
    );
    return;
  }

  // Build assets + allowlisted public assets: cache-first.
  if (
    CACHEABLE_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
    CACHEABLE_PATHS.includes(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(RUNTIME_CACHE).then((c) => c.put(request, clone));
            }
            return response;
          })
      )
    );
  }
  // Everything else (incl. /api/*): pass through to the network untouched.
  // A GET-API read-cache allowlist is deliberately empty in Phase 0.
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_RUNTIME_CACHE') {
    // Called on logout so a shared/kiosk device can't serve the previous
    // session's cached navigations offline.
    event.waitUntil(caches.delete(RUNTIME_CACHE));
  }
});
