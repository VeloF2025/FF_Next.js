/**
 * Offline Banner Component
 * Displays a contextual banner when the device is offline or when there
 * are pending operations waiting to be synced to the server.
 *
 * - Yellow banner while offline
 * - Blue banner when online with pending operations
 * - Hidden when online and fully synced
 */

'use client';

import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useOnlineStatus } from './useOnlineStatus';
import { offlineStorage } from './offlineStorage';

interface OfflineBannerProps {
  /** Additional CSS classes for the outer container */
  className?: string;
}

export function OfflineBanner({ className = '' }: OfflineBannerProps) {
  const { isOnline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // Poll pending operation count every 5 seconds
  useEffect(() => {
    const checkPending = async () => {
      try {
        const count = await offlineStorage.count();
        setPendingCount(count);
      } catch {
        // Non-fatal: IndexedDB may be unavailable in certain contexts
      }
    };

    void checkPending();
    const interval = setInterval(() => void checkPending(), 5_000);
    return () => clearInterval(interval);
  }, []);

  // Nothing to display when online and fully synced
  if (isOnline && pendingCount === 0) return null;

  const handleSync = () => {
    setSyncing(true);
    // Signal the service worker to trigger a background sync;
    // the SW will postMessage back and the app's sync handler resets this state.
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SYNC_REQUESTED' });
    }
    // Reset spinner after a reasonable wait
    setTimeout(() => setSyncing(false), 3_000);
  };

  const isOfflineBanner = !isOnline;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-between px-4 py-2 text-sm font-medium ${
        isOfflineBanner
          ? 'bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200'
          : 'bg-blue-50 text-blue-800 dark:bg-blue-900/30 dark:text-blue-200'
      } ${className}`}
    >
      <div className="flex items-center gap-2">
        {isOfflineBanner && <WifiOff className="h-4 w-4 shrink-0" aria-hidden />}
        <span>
          {isOfflineBanner
            ? 'You are offline. Changes will sync when connected.'
            : `${pendingCount} pending operation${pendingCount !== 1 ? 's' : ''} to sync`}
        </span>
      </div>

      {isOnline && pendingCount > 0 && (
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          aria-label="Sync pending operations"
          className="flex items-center gap-1 rounded px-2 py-1 hover:bg-blue-100 disabled:opacity-50 dark:hover:bg-blue-800/30"
        >
          {syncing ? (
            <InlineSpinner size="sm" />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden />
          )}
          Sync
        </button>
      )}
    </div>
  );
}
