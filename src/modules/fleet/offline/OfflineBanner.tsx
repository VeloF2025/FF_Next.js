/**
 * Offline Banner Component
 * Displays connection status, pending sync items, and sync progress
 */

import { useEffect, useState } from 'react';
import {
  WifiOff,
  RefreshCw,
  Check,
  AlertCircle,
  Cloud,
  CloudOff,
  CheckCircle,
} from 'lucide-react';
import { useOnlineStatus } from './useOnlineStatus';
import { useOfflineSync } from './useOfflineSync';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface OfflineBannerProps {
  className?: string;
}

export function OfflineBanner({ className = '' }: OfflineBannerProps) {
  const { isOnline, wasOffline } = useOnlineStatus();
  const {
    isSyncing,
    progress,
    lastSyncResult,
    pendingCount,
    fuelCount,
    checkInCount,
    triggerSync,
  } = useOfflineSync();

  const [showSuccess, setShowSuccess] = useState(false);
  const [showBanner, setShowBanner] = useState(false);

  // Determine if banner should show
  useEffect(() => {
    setShowBanner(!isOnline || pendingCount > 0 || isSyncing || showSuccess);
  }, [isOnline, pendingCount, isSyncing, showSuccess]);

  // Show success message briefly after sync completes
  useEffect(() => {
    if (lastSyncResult?.success && lastSyncResult.synced > 0) {
      setShowSuccess(true);
      const timer = setTimeout(() => setShowSuccess(false), 4000);
      return () => clearTimeout(timer);
    }
  }, [lastSyncResult]);

  const handleSync = async () => {
    if (isSyncing || !isOnline) return;
    await triggerSync();
  };

  // Don't show banner if online, no pending, not syncing, no success message
  if (!showBanner) return null;

  // Offline state
  if (!isOnline) {
    return (
      <div
        className={`bg-amber-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center justify-between ${className}`}
      >
        <div className="flex items-center gap-3">
          <CloudOff className="w-5 h-5 flex-shrink-0" />
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
          <div className="bg-amber-600/50 px-3 py-1 rounded-full flex-shrink-0">
            <span className="text-sm font-medium">{pendingCount} pending</span>
          </div>
        )}
      </div>
    );
  }

  // Syncing in progress
  if (isSyncing && progress) {
    const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
    return (
      <div
        className={`bg-blue-500/90 backdrop-blur-sm text-white px-4 py-3 ${className}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <InlineSpinner size="sm" className="flex-shrink-0" />
            <div>
              <p className="font-medium text-sm">
                Syncing... {progress.completed}/{progress.total}
              </p>
              <p className="text-xs text-blue-100">
                {progress.current || 'Preparing...'}
              </p>
            </div>
          </div>
          <span className="text-sm font-bold">{percent}%</span>
        </div>
        {/* Progress bar */}
        <div className="w-full bg-blue-400/30 rounded-full h-1.5">
          <div
            className="bg-card h-1.5 rounded-full transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    );
  }

  // Sync completed with errors
  if (lastSyncResult && !lastSyncResult.success && lastSyncResult.failed > 0) {
    return (
      <div
        className={`bg-red-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center justify-between ${className}`}
      >
        <div className="flex items-center gap-3">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">
              Sync partially failed
            </p>
            <p className="text-xs text-red-100">
              {lastSyncResult.synced} synced, {lastSyncResult.failed} failed
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          className="flex items-center gap-2 bg-card/20 hover:bg-card/30 px-4 py-2 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="text-sm font-medium">Retry</span>
        </button>
      </div>
    );
  }

  // Sync completed successfully
  if (showSuccess) {
    return (
      <div
        className={`bg-green-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center gap-3 ${className}`}
      >
        <CheckCircle className="w-5 h-5 flex-shrink-0" />
        <p className="font-medium text-sm">
          {lastSyncResult?.synced || 0} item{(lastSyncResult?.synced || 0) !== 1 ? 's' : ''} synced successfully!
        </p>
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
          <Cloud className="w-5 h-5 flex-shrink-0" />
          <div>
            <p className="font-medium text-sm">
              {pendingCount} item{pendingCount > 1 ? 's' : ''} pending sync
            </p>
            <p className="text-xs text-blue-100">
              {fuelCount > 0 && `${fuelCount} fuel`}
              {fuelCount > 0 && checkInCount > 0 && ', '}
              {checkInCount > 0 && `${checkInCount} check-in${checkInCount > 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        <button
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 bg-card/20 hover:bg-card/30 px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          <span className="text-sm font-medium">Sync Now</span>
        </button>
      </div>
    );
  }

  // Just came back online (wasOffline flag)
  if (wasOffline) {
    return (
      <div
        className={`bg-green-500/90 backdrop-blur-sm text-white px-4 py-3 flex items-center gap-3 ${className}`}
      >
        <Check className="w-5 h-5 flex-shrink-0" />
        <p className="font-medium text-sm">Back online!</p>
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
  const { pendingCount, isSyncing } = useOfflineSync();

  if (isOnline && pendingCount === 0 && !isSyncing) return null;

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${
        !isOnline
          ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
          : isSyncing
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      } ${className}`}
    >
      {!isOnline ? (
        <>
          <WifiOff className="w-3 h-3" />
          <span>Offline</span>
        </>
      ) : isSyncing ? (
        <>
          <InlineSpinner size="sm" />
          <span>Syncing</span>
        </>
      ) : (
        <>
          <Cloud className="w-3 h-3" />
          <span>{pendingCount}</span>
        </>
      )}
    </div>
  );
}
