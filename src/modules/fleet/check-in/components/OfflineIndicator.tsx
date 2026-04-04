/**
 * OfflineIndicator Component
 * Shows offline status and sync queue
 */

import React from 'react';
import { Wifi, WifiOff, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useOfflineSync } from '../hooks/useOfflineSync';

interface OfflineIndicatorProps {
  showDetails?: boolean;
}

export function OfflineIndicator({ showDetails = false }: OfflineIndicatorProps) {
  const {
    isOnline,
    syncStatus,
    isSyncing,
    syncAll,
    offlineRecordCount,
  } = useOfflineSync();

  // Don't show anything if online with no pending items
  if (isOnline && offlineRecordCount === 0 && !showDetails) {
    return null;
  }

  return (
    <div className={`mx-4 mb-4 p-3 rounded-lg border ${
      isOnline
        ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
        : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <Wifi className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          )}
          <span className={`text-sm font-medium ${
            isOnline
              ? 'text-green-700 dark:text-green-400'
              : 'text-amber-700 dark:text-amber-400'
          }`}>
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>

        {offlineRecordCount > 0 && (
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Cloud className="w-4 h-4 text-blue-500" />
            ) : (
              <CloudOff className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm text-muted-foreground">
              {offlineRecordCount} pending
            </span>
            {isOnline && (
              <button
                onClick={syncAll}
                disabled={isSyncing}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50"
                title="Sync now"
              >
                {isSyncing ? (
                  <InlineSpinner size="sm" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detailed status */}
      {showDetails && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-semibold text-foreground">
                {syncStatus.pending}
              </p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">
                {syncStatus.syncing}
              </p>
              <p className="text-xs text-muted-foreground">Syncing</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-red-600 dark:text-red-400">
                {syncStatus.failed}
              </p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>
          {syncStatus.lastSyncAt && (
            <p className="mt-2 text-xs text-muted-foreground text-center">
              Last sync: {new Date(syncStatus.lastSyncAt).toLocaleString()}
            </p>
          )}
        </div>
      )}

      {/* Offline message */}
      {!isOnline && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Check-ins will be saved locally and synced when back online.
        </p>
      )}
    </div>
  );
}
