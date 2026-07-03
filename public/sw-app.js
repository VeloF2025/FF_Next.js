/**
 * Root service worker for the main FibreFlow app (scope '/').
 *
 * Provides: installable offline shell + runtime read-cache (stale-while-
 * revalidate for navigations, cache-first for static assets). Deliberately
 * NEVER touches the sub-scopes that already own a service worker
 * (/my → sw-my.js, field-stock → sw-stock.js, fleet → sw-fleet.js) nor any
 * non-GET request (mutations go to the network or the app's offline queue).
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

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => (n.startsWith('app-shell-') || n.startsWith('app-runtime-')) &&
            n !== SHELL_CACHE && n !== RUNTIME_CACHE)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
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

  // Static build assets + images: cache-first with background refresh.
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|webp|woff|woff2)$/)
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
});
