/**
 * Service worker registration hook for the /my staff portal.
 *
 * Mirrors src/modules/fleet/offline/useServiceWorker.ts but scoped to /my/
 * and pointing at /sw-my.js. Returns an `updateAvailable` flag so the shell
 * can render a "tap to reload" banner when a new SW version is waiting.
 */

import { useCallback, useEffect, useState } from 'react';

import { log } from '@/lib/logger';

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  registration: ServiceWorkerRegistration | null;
  updateAvailable: boolean;
  error: string | null;
}

export function useMyServiceWorker() {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    registration: null,
    updateAvailable: false,
    error: null,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isSupported = 'serviceWorker' in navigator;
    setState((prev) => ({ ...prev, isSupported }));

    if (!isSupported) {
      log.info('[SW-my] Service Workers not supported');
      return;
    }

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw-my.js', {
          scope: '/my/',
        });

        log.info('[SW-my] registered', { scope: registration.scope });

        setState((prev) => ({
          ...prev,
          isRegistered: true,
          registration,
        }));

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                log.info('[SW-my] new version available');
                setState((prev) => ({ ...prev, updateAvailable: true }));
              }
            });
          }
        });
      } catch (error) {
        log.error('[SW-my] registration failed', { error });
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Registration failed',
        }));
      }
    };

    registerSW();
  }, []);

  const updateServiceWorker = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [state.registration]);

  return {
    ...state,
    updateServiceWorker,
  };
}
