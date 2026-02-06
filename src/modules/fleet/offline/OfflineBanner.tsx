/**
 * Offline Banner Component
 * Displays connection status and pending sync items for fleet portal
 */

import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw, Check, AlertTriangle, Cloud, CloudOff } from 'lucide-react';
import { useOnlineStatus } from './useOnlineStatus';
import { offlineStorage } from './offlineStorage';

interface OfflineBannerProps {
  onSyncRequested?: () => void;
  className?: string;
}

export function OfflineBanner({ onSyncRequested, className = '' }: OfflineBannerProps) {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  // Check pending items count
  useEffect(() => {
    const checkPending = async () => {
      try {
        const count = await offlineStorage.getPendingCount();
        setPendingCount(count);
        setShowBanner(!isOnline || count > 0);
      } catch (error) {
        console.error('[OfflineBanner] Error checking pending count:', error);
      }
    };

    checkPending();

    // Re-check when online status changes
    const interval = setInterval(checkPending, 5000);
    return () => clearInterval(interval);
  }, [isOnline]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (wasOffline && isOnline && pendingCount > 0) {
      handleSync();
    }
  }, [wasOffline, isOnline, pendingCount]);

  const handleSync = async () => {
    if (isSyncing || !isOnline) return;

    setIsSyncing(true);
    try {
      if (onSyncRequested) {
        await onSyncRequested();
      }
      // Refresh count after sync
      const count = await offlineStorage.getPendingCount();
      setPendingCount(count);
    } catch (error) {
      console.error('[OfflineBanner] Sync failed:', error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Don't show banner if online and no pending items
  if (!showBanner) return null;

  // Offline state
  if (!isOnline) {
    return (
      <div
        className={`bg-amber-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center justify-between ${className}`}
      >
        <div className="flex items-center gap-3">
          <CloudOff className="w-5 h-5" />
          <div>
            <p className="font-medium text-sm">You&apos;re offline</p>
            <p className="text-xs text-amber-100">
              {pendingCount > 0
                ? `${pendingCount} item${pendingCount > 1 ? 's' : ''} will sync when connected`
                : 'Data will be saved locally'}
            </p>
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="bg-amber-600/50 px-3 py-1 rounded-full">
            <span className="text-sm font-medium">{pendingCount} pending</span>
          </div>
        )}
      </div>
    );
  }

  // Online with pending items
  if (pendingCount > 0) {
    return (
      <div
        className={`bg-blue-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center justify-between ${className}`}
      >
        <div className="flex items-center gap-3">
          <Cloud className="w-5 h-5" />
          <div>
            <p className="font-medium text-sm">
              {isSyncing ? 'Syncing...' : `${pendingCount} item${pendingCount > 1 ? 's' : ''} pending sync`}
            </p>
            <p className="text-xs text-blue-100">
              {isSyncing ? 'Please wait while data is uploaded' : 'Tap sync to upload saved data'}
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">{isSyncing ? 'Syncing' : 'Sync Now'}</span>
        </button>
      </div>
    );
  }

  // Just came back online
  if (wasOffline) {
    return (
      <div
        className={`bg-green-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center gap-3 ${className}`}
      >
        <Check className="w-5 h-5" />
        <p className="font-medium text-sm">Back online - all data synced!</p>
      </div>
    );
  }

  return null;
}

/**
 * Compact offline indicator for header/navbar
 */
export function OfflineIndicator({ className = '' }: { className?: string }) {
  const { isOnline } = useOnlineStatus();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const checkPending = async () => {
      try {
        const count = await offlineStorage.getPendingCount();
        setPendingCount(count);
      } catch {
        // Ignore errors
      }
    };
    checkPending();
    const interval = setInterval(checkPending, 10000);
    return () => clearInterval(interval);
  }, []);

  if (isOnline && pendingCount === 0) return null;

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
        isOnline
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
      } ${className}`}
    >
      {isOnline ? (
        <>
          <Cloud className="w-3 h-3" />
          <span>{pendingCount}</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3" />
          <span>Offline</span>
        </>
      )}
    </div>
  );
}
