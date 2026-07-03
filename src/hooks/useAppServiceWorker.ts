/**
 * Root service-worker registration for the main app. Mirrors
 * src/modules/attendance/portal/client/useServiceWorker.ts, but registers
 * /sw-app.js at scope '/'. Exposes updateAvailable so the app can render a
 * "new version — reload" prompt. Registration is a no-op during SSR and where
 * Service Workers are unsupported.
 */

import { useCallback, useEffect, useState } from 'react';

import { log } from '@/lib/logger';

interface State {
  isSupported: boolean;
  isRegistered: boolean;
  registration: ServiceWorkerRegistration | null;
  updateAvailable: boolean;
  error: string | null;
}

export function useAppServiceWorker() {
  const [state, setState] = useState<State>({
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
      log.info('[SW-app] Service Workers not supported');
      return;
    }

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw-app.js', { scope: '/' });
        log.info('[SW-app] registered', { scope: registration.scope });
        setState((prev) => ({ ...prev, isRegistered: true, registration }));
        registration.addEventListener('updatefound', () => {
          const nw = registration.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              log.info('[SW-app] new version available');
              setState((prev) => ({ ...prev, updateAvailable: true }));
            }
          });
        });
      } catch (error) {
        log.error('[SW-app] registration failed', { error });
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : 'Registration failed',
        }));
      }
    };
    void register();
  }, []);

  const updateServiceWorker = useCallback(() => {
    if (state.registration?.waiting) {
      state.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }, [state.registration]);

  return { ...state, updateServiceWorker };
}
