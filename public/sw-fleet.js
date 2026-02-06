/**
 * Fleet Portal Service Worker
 * Handles offline caching and background sync for fleet operations
 */

const CACHE_NAME = 'fleet-portal-v1';
const OFFLINE_CACHE = 'fleet-offline-v1';

// Assets to cache for offline use
const STATIC_ASSETS = [
  '/fleet/portal',
  '/offline.html',
];

// API routes that should work offline (will queue requests)
const OFFLINE_API_ROUTES = [
  '/api/fleet/vehicles/',
  '/api/fleet/upload',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Fleet Service Worker');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Fleet Service Worker');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('fleet-') && name !== CACHE_NAME && name !== OFFLINE_CACHE)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests for caching (POST/PUT will use background sync)
  if (request.method !== 'GET') {
    return;
  }

  // For navigation requests, try network first, fall back to cache
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached version or offline page
          return caches.match(request).then((cached) => {
            return cached || caches.match('/offline.html');
          });
        })
    );
    return;
  }

  // For other requests, try cache first for static assets
  if (url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff|woff2)$/)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return cached || fetch(request).then((response) => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }
});

// Background sync event - process queued offline operations
self.addEventListener('sync', (event) => {
  console.log('[SW] Sync event:', event.tag);

  if (event.tag === 'fleet-sync') {
    event.waitUntil(processOfflineQueue());
  }
});

// Process offline queue from IndexedDB
async function processOfflineQueue() {
  console.log('[SW] Processing offline queue');

  // This will be handled by the main app via postMessage
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({
      type: 'SYNC_REQUESTED',
      timestamp: Date.now(),
    });
  });
}

// Listen for messages from the app
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data.type === 'CACHE_URLS') {
    const urls = event.data.urls || [];
    caches.open(CACHE_NAME).then((cache) => {
      cache.addAll(urls);
    });
  }
});

// Periodic sync for regular background updates (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'fleet-periodic-sync') {
    event.waitUntil(processOfflineQueue());
  }
});

console.log('[SW] Fleet Service Worker loaded');
