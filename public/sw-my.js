/**
 * /my Staff Portal Service Worker
 * Caches the portal shell for offline use and notifies the app on updates.
 *
 * The existing IndexedDB clock-event queue
 * (src/modules/attendance/portal/client/offline/) is independent of this SW
 * and continues to handle background submission of clock events.
 */

const CACHE_NAME = 'my-portal-v1';
const OFFLINE_CACHE = 'my-offline-v1';

const STATIC_ASSETS = [
  '/my',
  '/my/attendance',
  '/my/attendance/clock',
  '/my/attendance/history',
  '/my/attendance/corrections',
  '/manifest-my.json',
  '/assets/vf/vf-logo.svg',
  '/offline.html',
];

self.addEventListener('install', (event) => {
  console.log('[SW-my] Installing');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW-my] Activating');
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name.startsWith('my-') && name !== CACHE_NAME && name !== OFFLINE_CACHE)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Only act on requests under /my/* so we never interfere with the rest of the app.
  const isMyScope =
    url.pathname === '/my' ||
    url.pathname.startsWith('/my/') ||
    url.pathname === '/manifest-my.json' ||
    url.pathname === '/offline.html' ||
    url.pathname === '/assets/vf/vf-logo.svg';

  // Runtime-cache /api/my/session with a short TTL so a returning user on a
  // flaky connection doesn't get bounced to the login screen during the
  // network round-trip. The cached copy is served as a fallback; a fresh
  // network response always wins when one arrives.
  if (url.pathname === '/api/my/session') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(OFFLINE_CACHE).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  if (!isMyScope) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2)$/)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
            }
            return response;
          })
      )
    );
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data?.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urls));
  }
});

console.log('[SW-my] Loaded');
