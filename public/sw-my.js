/**
 * /my Staff Portal Service Worker
 * Caches the portal shell for offline use and notifies the app on updates.
 *
 * The existing IndexedDB clock-event queue
 * (src/modules/attendance/portal/client/offline/) is independent of this SW
 * and continues to handle background submission of clock events.
 */

// Bump CACHE_NAME on any change to a precached STATIC_ASSET (e.g. the shared
// /offline.html) so an already-installed SW reinstalls and the activate handler
// purges the stale copy — otherwise /my keeps serving the old cached shell.
// (Update lands via the /my UpdatePrompt "Reload" — this SW deliberately waits.)
const CACHE_NAME = 'my-portal-v5';
const OFFLINE_CACHE = 'my-offline-v1';
const AUTH_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const AUTH_CACHE_PATHS = new Set(['/api/my/session', '/api/auth/me']);
const CACHED_AT_HEADER = 'x-ff-cached-at';

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
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  // NOTE: deliberately NO self.skipWaiting() here. An updated SW must WAIT so
  // the /my UpdatePrompt can offer "Reload" — its click posts SKIP_WAITING
  // (handled below) to activate the new worker on the user's terms. Calling
  // skipWaiting() in install would auto-activate the update immediately,
  // making that prompt's Reload a no-op. First install still activates fine:
  // with no controller to replace there is no waiting phase, and the activate
  // handler's self.clients.claim() takes control of the open /my tab.
});

self.addEventListener('activate', (event) => {
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

  // A controlled /my page still loads its executable shell from
  // /_next/static/*. Those requests are outside the registration scope path,
  // but they are dispatched to this worker because the requesting page is
  // controlled. Serve the locally cached copies before the /my-only guard so
  // a cold offline navigation can hydrate instead of rendering blank HTML.
  const isPortalStaticAsset =
    url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');

  if (isPortalStaticAsset) {
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
    return;
  }

  // The portal needs both auth contracts to boot offline. Keep them for the
  // same short window as attendance eligibility; a stale identity response
  // must never extend offline clock authority.
  if (AUTH_CACHE_PATHS.has(url.pathname)) {
    if (self.navigator.onLine === false) {
      event.respondWith(freshCachedAuthResponse(request));
      return;
    }
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            await cacheAuthResponse(request, response);
            return response;
          }
          if (response.status >= 500) {
            const cached = await freshCachedAuthResponse(request);
            if (cached.type !== 'error') return cached;
          }
          return response;
        })
        .catch(() => freshCachedAuthResponse(request))
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

  if (event.data?.type === 'CLEAR_SESSION_CACHE') {
    // Called from logout: drop both identity contracts so an offline reload
    // cannot serve the previous worker's authenticated portal.
    event.waitUntil(clearAuthCache().then(() => {
      event.ports[0]?.postMessage({ type: 'SESSION_CACHE_CLEARED' });
    }));
  }
});

async function clearAuthCache() {
  const cache = await caches.open(OFFLINE_CACHE);
  const keys = await cache.keys();
  await Promise.all(keys
    .filter((request) => AUTH_CACHE_PATHS.has(new URL(request.url).pathname))
    .map((request) => cache.delete(request)));
}

async function cacheAuthResponse(request, response) {
  const headers = new Headers(response.headers);
  headers.set(CACHED_AT_HEADER, String(Date.now()));
  const cached = new Response(await response.clone().blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
  const cache = await caches.open(OFFLINE_CACHE);
  await cache.put(authCacheKey(request), cached);
}

async function freshCachedAuthResponse(request) {
  const cache = await caches.open(OFFLINE_CACHE);
  const key = authCacheKey(request);
  const cached = await cache.match(key);
  const cachedAt = Number(cached?.headers.get(CACHED_AT_HEADER));
  const age = Date.now() - cachedAt;
  if (!cached || !Number.isFinite(age) || age < 0 || age > AUTH_CACHE_MAX_AGE_MS) {
    if (cached) await cache.delete(key);
    return Response.error();
  }
  return cached;
}

function authCacheKey(request) {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: 'GET' });
}
