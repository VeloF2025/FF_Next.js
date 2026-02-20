/**
 * Online/Offline Status Hook
 * Subscribes to browser online/offline events and exposes the current
 * connectivity state. SSR-safe (defaults to true on the server).
 */

import { useState, useEffect } from 'react';

interface OnlineStatus {
  /** True when the browser reports a network connection */
  isOnline: boolean;
}

/**
 * Returns the current online status of the browser and re-renders
 * automatically when the network state changes.
 */
export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    // navigator is undefined during SSR; default to true
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline };
}
