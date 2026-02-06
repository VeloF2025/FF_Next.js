/**
 * Service Worker Registration Hook
 * Handles SW registration and sync triggering for fleet portal
 */

import { useEffect, useState, useCallback } from 'react';

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  registration: ServiceWorkerRegistration | null;
  updateAvailable: boolean;
  error: string | null;
}

export function useServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    registration: null,
    updateAvailable: false,
    error: null,
  });

  // Register the service worker
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isSupported = 'serviceWorker' in navigator;
    setState((prev) => ({ ...prev, isSupported }));

    if (!isSupported) {
      console.log('[SW] Service Workers not supported');
      return;
    }

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw-fleet.js', {
          scope: '/fleet/',
        });

        console.log('[SW] Service Worker registered:', registration.scope);

        setState((prev) => ({
          ...prev,
          isRegistered: true,
          registration,
        }));

        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version available');
                setState((prev) => ({ ...prev, updateAvailable: true }));
              }
            });
          }
        });

        // Listen for messages from SW
        navigator.serviceWorker.addEventListener('message', (event) => {
          console.log('[SW] Message from Service Worker:', event.data);

          if (event.data.type === 'SYNC_REQUESTED') {
            // Trigger sync from the app
            window.dispatchEvent(new CustomEvent('fleet-sync-requested'));
          }
        });
      } catch (error) {
        console.error('[SW] Registration failed:', error);
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Registration failed',
        }));
      }
    };

    registerSW();
  }, []);

  // Request background sync
  const requestSync = useCallback(async () => {
    if (!state.registration) {
      console.log('[SW] No registration, cannot request sync');
      return false;
    }

    try {
      // Check if background sync is supported
      if ('sync' in state.registration) {
        await (state.registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('fleet-sync');
        console.log('[SW] Background sync registered');
        return true;
      } else {
        console.log('[SW] Background sync not supported, triggering manual sync');
        window.dispatchEvent(new CustomEvent('fleet-sync-requested'));
        return true;
      }
    } catch (error) {
      console.error('[SW] Sync registration failed:', error);
      return false;
    }
  }, [state.registration]);

  // Update to new version
  const updateServiceWorker = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [state.registration]);

  // Cache specific URLs
  const cacheUrls = useCallback(
    (urls: string[]) => {
      if (state.registration?.active) {
        state.registration.active.postMessage({
          type: 'CACHE_URLS',
          urls,
        });
      }
    },
    [state.registration]
  );

  return {
    ...state,
    requestSync,
    updateServiceWorker,
    cacheUrls,
  };
}
