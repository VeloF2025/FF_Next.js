/**
 * useOnlineStatus — reactive navigator.onLine subscription.
 *
 * Hoisted from:
 *  - src/modules/field-stock-pwa/offline/useOnlineStatus.ts
 *  - src/modules/attendance/portal/client/offline/useOnlineStatus.ts
 * (both were byte-for-byte identical)
 *
 * Returns a plain boolean (true = online) so callers can write
 *   `if (online) void drain();`
 * without destructuring.
 *
 * Returns `true` during SSR so the UI doesn't flash "offline" for the first
 * render before hydration. Real client state takes over on mount.
 */

import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return online;
}
