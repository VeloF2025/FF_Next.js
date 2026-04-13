/**
 * Fleet Offline Sync Engine
 * Handles syncing offline data when connection is restored
 */

import {
  offlineStorage,
  PendingFuelTransaction,
  PendingCheckIn,
  PendingPhoto,
  SyncQueueItem,
} from './offlineStorage';
import { log } from '@/lib/logger';

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
  current: string | null;
  status: 'idle' | 'syncing' | 'complete' | 'error';
  errors: Array<{ id: string; error: string }>;
}

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

type ProgressCallback = (progress: SyncProgress) => void;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Upload a photo blob to VF Storage
 */
async function uploadPhotoBlob(
  photo: PendingPhoto,
  folder: string
): Promise<string | null> {
  try {
    const formData = new FormData();
    const file = new File([photo.blob], photo.fileName, { type: photo.mimeType });
    formData.append('file', file);
    formData.append('folder', folder);

    const response = await fetch('/api/fleet/upload', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      log.error('[SyncEngine] Photo upload failed', { status: response.status });
      return null;
    }

    const data = await response.json();
    return data.data?.url || null;
  } catch (error) {
    log.error('[SyncEngine] Photo upload error', { error });
    return null;
  }
}

/**
 * Sync a single fuel transaction
 */
async function syncFuelTransaction(
  transaction: PendingFuelTransaction
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get associated photos
    const photos = await offlineStorage.getPhotosByParent(transaction.id);

    let receiptPhotoUrl: string | null = null;
    let odometerPhotoUrl: string | null = null;

    // Upload receipt photo
    const receiptPhoto = photos.find((p) => p.photoType === 'receipt');
    if (receiptPhoto) {
      receiptPhotoUrl = await uploadPhotoBlob(receiptPhoto, 'fleet/fuel-receipts');
      if (!receiptPhotoUrl) {
        return { success: false, error: 'Failed to upload receipt photo' };
      }
    }

    // Upload odometer photo
    const odometerPhoto = photos.find((p) => p.photoType === 'odometer');
    if (odometerPhoto) {
      odometerPhotoUrl = await uploadPhotoBlob(odometerPhoto, 'fleet/fuel-odometers');
      // Odometer photo is optional, don't fail if it doesn't upload
    }

    // Submit to API
    const response = await fetch(
      `/api/fleet/vehicles/${transaction.vehicleId}/fuel-transactions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          transactionDate: transaction.transactionDate,
          amountRand: transaction.amountRand,
          litres: transaction.litres,
          pricePerLitre: transaction.pricePerLitre,
          odometerReading: transaction.odometerReading,
          stationName: transaction.stationName,
          receiptPhotoUrl,
          odometerPhotoUrl,
          gpsLat: transaction.gpsLat,
          gpsLng: transaction.gpsLng,
          captureTimestamp: transaction.captureTimestamp,
          source: 'hybrid',
        }),
      }
    );

    if (!response.ok) {
      const jsonResult = await response.json().catch((_e: unknown) => null);
      const data: Record<string, unknown> = jsonResult ?? Object.create(null);
      return {
        success: false,
        error: data.error?.message || data.message || `API error: ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Sync a single check-in
 */
async function syncCheckIn(
  checkIn: PendingCheckIn
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get associated photos
    const photos = await offlineStorage.getPhotosByParent(checkIn.id);

    const uploadedPhotos: Array<{ type: string; url: string }> = [];

    // Upload all photos
    for (const photo of photos) {
      const folder = `fleet/check-in-photos`;
      const url = await uploadPhotoBlob(photo, folder);
      if (url) {
        uploadedPhotos.push({ type: photo.photoType, url });
      }
    }

    // Submit to API
    const response = await fetch(
      `/api/fleet/vehicles/${checkIn.vehicleId}/check-in`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          checkType: checkIn.checkType,
          checkDate: checkIn.checkDate,
          driverName: checkIn.driverName,
          odometerReading: checkIn.odometerReading,
          fuelLevel: checkIn.fuelLevel,
          photos: uploadedPhotos,
          checklistResponses: checkIn.checklistResponses,
          gpsLat: checkIn.gpsLat,
          gpsLng: checkIn.gpsLng,
          captureTimestamp: checkIn.captureTimestamp,
          source: 'offline',
        }),
      }
    );

    if (!response.ok) {
      const jsonResult = await response.json().catch((_e: unknown) => null);
      const data: Record<string, unknown> = jsonResult ?? Object.create(null);
      return {
        success: false,
        error: data.error?.message || data.message || `API error: ${response.status}`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process a single sync queue item with retries
 */
async function processSyncItem(
  item: SyncQueueItem,
  _onProgress?: ProgressCallback,
  _currentProgress?: SyncProgress
): Promise<{ success: boolean; error?: string }> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log.info('[SyncEngine] Processing sync item', { type: item.type, itemId: item.itemId, attempt, maxRetries: MAX_RETRIES });

    let result: { success: boolean; error?: string };

    if (item.type === 'fuel') {
      const transaction = await offlineStorage.getFuelTransaction(item.itemId);
      if (!transaction) {
        return { success: false, error: 'Transaction not found' };
      }
      result = await syncFuelTransaction(transaction);
    } else if (item.type === 'checkin') {
      const checkIn = await offlineStorage.getCheckIn(item.itemId);
      if (!checkIn) {
        return { success: false, error: 'Check-in not found' };
      }
      result = await syncCheckIn(checkIn);
    } else {
      return { success: false, error: `Unknown item type: ${item.type}` };
    }

    if (result.success) {
      return { success: true };
    }

    lastError = result.error;

    // Don't retry on certain errors
    if (
      lastError?.includes('not found') ||
      lastError?.includes('already exists') ||
      lastError?.includes('duplicate')
    ) {
      break;
    }

    // Wait before retrying
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }

  return { success: false, error: lastError };
}

/**
 * Main sync function - processes all pending items
 */
export async function syncOfflineData(
  onProgress?: ProgressCallback
): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    synced: 0,
    failed: 0,
    errors: [],
  };

  const progress: SyncProgress = {
    total: 0,
    completed: 0,
    failed: 0,
    current: null,
    status: 'syncing',
    errors: [],
  };

  try {
    // Get sync queue
    const queue = await offlineStorage.getSyncQueue();
    progress.total = queue.length;

    if (queue.length === 0) {
      progress.status = 'complete';
      onProgress?.(progress);
      return result;
    }

    log.info('[SyncEngine] Starting sync', { queueLength: queue.length });
    onProgress?.(progress);

    // Process each item in order
    for (const item of queue) {
      progress.current = `${item.type}: ${item.itemId.slice(0, 8)}...`;
      onProgress?.(progress);

      // Mark as syncing
      await offlineStorage.updateSyncQueueItem(item.id, { status: 'syncing' });

      const syncResult = await processSyncItem(item, onProgress, progress);

      if (syncResult.success) {
        // Success - remove from queue and delete local data
        if (item.type === 'fuel') {
          await offlineStorage.deleteFuelTransaction(item.itemId);
        } else if (item.type === 'checkin') {
          await offlineStorage.deleteCheckIn(item.itemId);
        }
        await offlineStorage.removeSyncQueueItem(item.id);

        result.synced++;
        progress.completed++;
        log.info('[SyncEngine] Synced item', { type: item.type, itemId: item.itemId });
      } else {
        // Failed - mark as failed and continue
        await offlineStorage.updateSyncQueueItem(item.id, { status: 'failed' });

        result.failed++;
        progress.failed++;
        result.errors.push({ id: item.itemId, error: syncResult.error || 'Unknown error' });
        progress.errors.push({ id: item.itemId, error: syncResult.error || 'Unknown error' });
        log.error('[SyncEngine] Failed to sync item', { type: item.type, itemId: item.itemId, error: syncResult.error });
      }

      onProgress?.(progress);
    }

    result.success = result.failed === 0;
    progress.status = result.success ? 'complete' : 'error';
    progress.current = null;
    onProgress?.(progress);

    log.info('[SyncEngine] Sync complete', { synced: result.synced, failed: result.failed });
    return result;
  } catch (error) {
    log.error('[SyncEngine] Sync error', { error });
    progress.status = 'error';
    progress.current = null;
    onProgress?.(progress);

    result.success = false;
    result.errors.push({
      id: 'sync-engine',
      error: error instanceof Error ? error.message : 'Sync engine error',
    });
    return result;
  }
}

/**
 * Check if there are pending items to sync
 */
export async function hasPendingSync(): Promise<boolean> {
  const count = await offlineStorage.getPendingCount();
  return count > 0;
}

/**
 * Get sync status summary
 */
export async function getSyncStatus(): Promise<{
  pendingCount: number;
  fuelTransactions: number;
  checkIns: number;
}> {
  const [fuelTransactions, checkIns] = await Promise.all([
    offlineStorage.getAllPendingFuelTransactions(),
    offlineStorage.getAllPendingCheckIns(),
  ]);

  return {
    pendingCount: fuelTransactions.length + checkIns.length,
    fuelTransactions: fuelTransactions.length,
    checkIns: checkIns.length,
  };
}

/**
 * Retry failed items only
 */
export async function retryFailedItems(
  onProgress?: ProgressCallback
): Promise<SyncResult> {
  // Reset failed items to pending
  const queue = await offlineStorage.getSyncQueue();
  for (const item of queue) {
    if (item.status === 'failed') {
      await offlineStorage.updateSyncQueueItem(item.id, { status: 'pending' });
    }
  }

  // Run sync
  return syncOfflineData(onProgress);
}
