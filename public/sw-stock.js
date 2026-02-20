/**
 * Stock Portal Service Worker
 * Handles offline caching for field stock operations.
 * Network-first for API and portal page; cache-first for static assets.
 */

const CACHE_NAME = 'ff-stock-v1';
const PORTAL_URL = '/stock/portal';
const API_PREFIX = '/api/procurement/field-stock/';

// URLs to pre-cache during install
const PRECACHE_URLS = [
  PORTAL_URL,
];

// Install: pre-cache essential resources
self.addEventListener('install', (event) => {
  console.log('[SW:stock] Installing v1');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// Activate: remove stale stock caches
self.addEventListener('activate', (event) => {
  console.log('[SW:stock] Activating, cleaning old caches');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key.startsWith('ff-stock-'))
          .map((key) => {
            console.log('[SW:stock] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    )
  );
  self.clients.claim();
});

// Fetch: routing strategy per resource type
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // API calls: network-first with cache fallback
  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Portal page: network-first with cache fallback
  if (url.pathname === PORTAL_URL) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Static assets: cache-first
  if (url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request))
    );
  }
});

// Background sync: notify app to flush pending operations
self.addEventListener('sync', (event) => {
  console.log('[SW:stock] Sync event:', event.tag);
  if (event.tag === 'stock-sync') {
    event.waitUntil(notifyClientsToSync());
  }
});

// Notify all open tabs to flush IndexedDB queue
async function notifyClientsToSync() {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_REQUESTED', timestamp: Date.now() });
  });
}

// Message handler
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW:stock] Stock Service Worker loaded');
