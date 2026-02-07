/**
 * Offline Sync Hook
 * Manages sync state and triggers for the fleet portal
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { syncOfflineData, getSyncStatus, SyncProgress, SyncResult } from './syncEngine';
import { useOnlineStatus } from './useOnlineStatus';
import { log } from '@/lib/logger';

interface UseSyncState {
  isSyncing: boolean;
  progress: SyncProgress | null;
  lastSyncResult: SyncResult | null;
  pendingCount: number;
  fuelCount: number;
  checkInCount: number;
}

interface UseOfflineSyncReturn extends UseSyncState {
  triggerSync: () => Promise<SyncResult | null>;
  refreshStatus: () => Promise<void>;
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const { isOnline, wasOffline } = useOnlineStatus();
  const [state, setState] = useState<UseSyncState>({
    isSyncing: false,
    progress: null,
    lastSyncResult: null,
    pendingCount: 0,
    fuelCount: 0,
    checkInCount: 0,
  });

  const syncInProgress = useRef(false);

  // Refresh pending counts
  const refreshStatus = useCallback(async () => {
    try {
      const status = await getSyncStatus();
      setState((prev) => ({
        ...prev,
        pendingCount: status.pendingCount,
        fuelCount: status.fuelTransactions,
        checkInCount: status.checkIns,
      }));
    } catch (error) {
      log.error('[useOfflineSync] Error refreshing status', { error });
    }
  }, []);

  // Trigger sync
  const triggerSync = useCallback(async (): Promise<SyncResult | null> => {
    if (!isOnline || syncInProgress.current) {
      log.info('[useOfflineSync] Cannot sync: offline or already syncing');
      return null;
    }

    syncInProgress.current = true;
    setState((prev) => ({ ...prev, isSyncing: true, progress: null }));

    try {
      const result = await syncOfflineData((progress) => {
        setState((prev) => ({ ...prev, progress }));
      });

      setState((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncResult: result,
      }));

      // Refresh counts after sync
      await refreshStatus();

      return result;
    } catch (error) {
      log.error('[useOfflineSync] Sync error', { error });
      setState((prev) => ({
        ...prev,
        isSyncing: false,
        lastSyncResult: {
          success: false,
          synced: 0,
          failed: 0,
          errors: [{ id: 'hook', error: String(error) }],
        },
      }));
      return null;
    } finally {
      syncInProgress.current = false;
    }
  }, [isOnline, refreshStatus]);

  // Initial status check
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  // Refresh status periodically
  useEffect(() => {
    const interval = setInterval(refreshStatus, 10000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // Auto-sync when coming back online
  useEffect(() => {
    if (wasOffline && isOnline && state.pendingCount > 0 && !state.isSyncing) {
      log.info('[useOfflineSync] Back online with pending items, triggering sync');
      // Small delay to ensure connection is stable
      const timer = setTimeout(() => {
        triggerSync();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [wasOffline, isOnline, state.pendingCount, state.isSyncing, triggerSync]);

  // Listen for sync requests from service worker
  useEffect(() => {
    const handleSyncRequest = () => {
      if (isOnline && state.pendingCount > 0 && !state.isSyncing) {
        triggerSync();
      }
    };

    window.addEventListener('fleet-sync-requested', handleSyncRequest);
    return () => window.removeEventListener('fleet-sync-requested', handleSyncRequest);
  }, [isOnline, state.pendingCount, state.isSyncing, triggerSync]);

  return {
    ...state,
    triggerSync,
    refreshStatus,
  };
}
