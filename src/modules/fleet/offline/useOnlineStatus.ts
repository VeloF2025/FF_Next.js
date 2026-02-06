/**
 * Online Status Hook
 * Detects and tracks network connectivity for offline support
 */

import { useState, useEffect, useCallback } from 'react';

interface OnlineStatus {
  isOnline: boolean;
  wasOffline: boolean; // True if was offline and just came back
  lastOnlineAt: Date | null;
  lastOfflineAt: Date | null;
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>({
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    wasOffline: false,
    lastOnlineAt: null,
    lastOfflineAt: null,
  });

  const handleOnline = useCallback(() => {
    setStatus((prev) => ({
      isOnline: true,
      wasOffline: !prev.isOnline, // Was offline before this
      lastOnlineAt: new Date(),
      lastOfflineAt: prev.lastOfflineAt,
    }));
  }, []);

  const handleOffline = useCallback(() => {
    setStatus((prev) => ({
      isOnline: false,
      wasOffline: false,
      lastOnlineAt: prev.lastOnlineAt,
      lastOfflineAt: new Date(),
    }));
  }, []);

  useEffect(() => {
    // Set initial state
    setStatus((prev) => ({
      ...prev,
      isOnline: navigator.onLine,
      lastOnlineAt: navigator.onLine ? new Date() : null,
    }));

    // Listen for online/offline events
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  // Clear wasOffline flag after a short delay
  useEffect(() => {
    if (status.wasOffline) {
      const timer = setTimeout(() => {
        setStatus((prev) => ({ ...prev, wasOffline: false }));
      }, 5000); // Clear after 5 seconds
      return () => clearTimeout(timer);
    }
  }, [status.wasOffline]);

  return status;
}

/**
 * More robust online check that actually pings the server
 */
export async function checkServerReachable(url?: string): Promise<boolean> {
  try {
    const pingUrl = url || '/api/health';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(pingUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}
