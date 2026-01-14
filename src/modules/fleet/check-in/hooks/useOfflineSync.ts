/**
 * useOfflineSync Hook
 * Manages offline data synchronization
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { offlineStorage } from '../utils/offlineStorage';
import type { SyncCheckRecordRequest, SyncCheckRecordResponse } from '../../types/check-in.types';

interface SyncStatus {
  pending: number;
  syncing: number;
  failed: number;
  lastSyncAt: string | null;
}

interface UseOfflineSyncReturn {
  // Status
  isOnline: boolean;
  syncStatus: SyncStatus;
  isSyncing: boolean;

  // Actions
  syncAll: () => Promise<void>;
  syncRecord: (offlineId: string) => Promise<boolean>;
  clearFailed: () => Promise<void>;

  // Offline records
  offlineRecordCount: number;
}

export function useOfflineSync(): UseOfflineSyncReturn {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    pending: 0,
    syncing: 0,
    failed: 0,
    lastSyncAt: null,
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [offlineRecordCount, setOfflineRecordCount] = useState(0);

  const syncingRef = useRef(false);

  // Update online status
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

  // Load sync status
  const loadSyncStatus = useCallback(async () => {
    try {
      const status = await offlineStorage.getSyncQueueStatus();
      const records = await offlineStorage.getOfflineRecords();

      setSyncStatus(prev => ({
        ...status,
        lastSyncAt: prev.lastSyncAt,
      }));
      setOfflineRecordCount(records.length);
    } catch (error) {
      console.error('Failed to load sync status:', error);
    }
  }, []);

  // Load status on mount and when online status changes
  useEffect(() => {
    loadSyncStatus();
  }, [loadSyncStatus, isOnline]);

  // Sync a single record
  const syncRecord = useCallback(async (offlineId: string): Promise<boolean> => {
    try {
      const record = await offlineStorage.getOfflineRecord(offlineId);
      if (!record) return false;

      await offlineStorage.markAsSyncing(offlineId);

      // Prepare sync request
      const request: SyncCheckRecordRequest = {
        offlineId: record.offlineId,
        vehicleId: record.vehicleId,
        templateId: record.templateId,
        checkType: record.checkType,
        driverId: record.driverId,
        driverName: record.driverName,
        checkDate: record.checkDate,
        checkTime: record.checkTime,
        odometerReading: record.odometerReading,
        fuelLevel: record.fuelLevel,
        responses: record.responses,
        photos: record.photos.map(p => ({
          photoType: p.photoType,
          responseId: p.responseId,
          dataUrl: p.dataUrl,
          latitude: p.latitude,
          longitude: p.longitude,
          capturedAt: p.capturedAt,
        })),
      };

      const response = await fetch('/api/fleet/check-in/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const result = await response.json() as SyncCheckRecordResponse;

      if (result.success) {
        await offlineStorage.markAsSynced(offlineId);
        return true;
      } else {
        await offlineStorage.updateOfflineRecordSyncStatus(offlineId, result.error);
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sync failed';
      await offlineStorage.updateOfflineRecordSyncStatus(offlineId, message);
      return false;
    }
  }, []);

  // Sync all pending records
  const syncAll = useCallback(async () => {
    if (syncingRef.current || !isOnline) return;

    syncingRef.current = true;
    setIsSyncing(true);

    try {
      const pendingIds = await offlineStorage.getPendingSyncItems();

      for (const offlineId of pendingIds) {
        await syncRecord(offlineId);
      }

      setSyncStatus(prev => ({
        ...prev,
        lastSyncAt: new Date().toISOString(),
      }));

      await loadSyncStatus();
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isOnline, syncRecord, loadSyncStatus]);

  // Clear failed records
  const clearFailed = useCallback(async () => {
    const records = await offlineStorage.getOfflineRecords();
    const failedRecords = records.filter(r => r.syncAttempts >= 3);

    for (const record of failedRecords) {
      await offlineStorage.deleteOfflineRecord(record.offlineId);
    }

    await loadSyncStatus();
  }, [loadSyncStatus]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && offlineRecordCount > 0) {
      syncAll();
    }
  }, [isOnline, offlineRecordCount, syncAll]);

  return {
    isOnline,
    syncStatus,
    isSyncing,
    syncAll,
    syncRecord,
    clearFailed,
    offlineRecordCount,
  };
}
