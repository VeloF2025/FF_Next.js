/**
 * Offline Storage for Fleet Check-In
 * Uses IndexedDB to store check-in records when offline
 * Simplified implementation without external dependencies
 */

import type {
  OfflineCheckRecord,
  OfflinePhoto,
  CreateCheckResponseInput,
  CheckPhotoType,
  CheckType,
} from '../../types/check-in.types';

// ============================================================================
// Database Constants
// ============================================================================

const DB_NAME = 'fleet-check-in-offline';
const DB_VERSION = 1;
const RECORDS_STORE = 'offline-records';
const PHOTOS_STORE = 'offline-photos';
const SYNC_QUEUE_STORE = 'sync-queue';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a UUID for offline records
 */
export function generateOfflineId(): string {
  return `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Check if we're online
 */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

/**
 * Open IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create records store
      if (!db.objectStoreNames.contains(RECORDS_STORE)) {
        const recordStore = db.createObjectStore(RECORDS_STORE, { keyPath: 'offlineId' });
        recordStore.createIndex('by-vehicle', 'vehicleId');
        recordStore.createIndex('by-date', 'checkDate');
      }

      // Create photos store
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
        const photoStore = db.createObjectStore(PHOTOS_STORE, { keyPath: 'id' });
        photoStore.createIndex('by-record', 'recordOfflineId');
      }

      // Create sync queue store
      if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
        db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'offlineId' });
      }
    };
  });
}

// ============================================================================
// Record Operations
// ============================================================================

/**
 * Save a check-in record offline
 */
export async function saveOfflineRecord(record: {
  vehicleId: string;
  templateId: string | null;
  checkType?: CheckType;
  driverId: string;
  driverName: string;
  odometerReading: number | null;
  fuelLevel?: number | null;
  responses: CreateCheckResponseInput[];
}): Promise<OfflineCheckRecord> {
  const db = await openDatabase();

  const now = new Date();
  const offlineRecord: OfflineCheckRecord = {
    offlineId: generateOfflineId(),
    vehicleId: record.vehicleId,
    templateId: record.templateId,
    checkType: record.checkType || 'daily',
    driverId: record.driverId,
    driverName: record.driverName,
    checkDate: now.toISOString().split('T')[0] ?? now.toISOString().substring(0, 10),
    checkTime: now.toTimeString().split(' ')[0] ?? '00:00:00',
    odometerReading: record.odometerReading,
    fuelLevel: record.fuelLevel ?? null,
    responses: record.responses,
    photos: [],
    createdAt: new Date().toISOString(),
    syncAttempts: 0,
    lastSyncError: null,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([RECORDS_STORE, SYNC_QUEUE_STORE], 'readwrite');
    const recordStore = transaction.objectStore(RECORDS_STORE);
    const syncStore = transaction.objectStore(SYNC_QUEUE_STORE);

    recordStore.put(offlineRecord);
    syncStore.put({
      offlineId: offlineRecord.offlineId,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: offlineRecord.createdAt,
    });

    transaction.oncomplete = () => {
      db.close();
      resolve(offlineRecord);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

/**
 * Get all offline records
 */
export async function getOfflineRecords(): Promise<OfflineCheckRecord[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDS_STORE, 'readonly');
    const store = transaction.objectStore(RECORDS_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Get offline records for a vehicle
 */
export async function getOfflineRecordsForVehicle(vehicleId: string): Promise<OfflineCheckRecord[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDS_STORE, 'readonly');
    const store = transaction.objectStore(RECORDS_STORE);
    const index = store.index('by-vehicle');
    const request = index.getAll(vehicleId);

    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Get an offline record by ID
 */
export async function getOfflineRecord(offlineId: string): Promise<OfflineCheckRecord | undefined> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDS_STORE, 'readonly');
    const store = transaction.objectStore(RECORDS_STORE);
    const request = store.get(offlineId);

    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Delete an offline record (after successful sync)
 */
export async function deleteOfflineRecord(offlineId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([RECORDS_STORE, PHOTOS_STORE, SYNC_QUEUE_STORE], 'readwrite');

    // Delete photos first
    const photosStore = transaction.objectStore(PHOTOS_STORE);
    const photosIndex = photosStore.index('by-record');
    const photosRequest = photosIndex.getAllKeys(offlineId);

    photosRequest.onsuccess = () => {
      const photoKeys = photosRequest.result;
      photoKeys.forEach((key) => photosStore.delete(key));
    };

    // Delete from sync queue
    const syncStore = transaction.objectStore(SYNC_QUEUE_STORE);
    syncStore.delete(offlineId);

    // Delete the record
    const recordStore = transaction.objectStore(RECORDS_STORE);
    recordStore.delete(offlineId);

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

/**
 * Update offline record sync status
 */
export async function updateOfflineRecordSyncStatus(
  offlineId: string,
  error?: string
): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([RECORDS_STORE, SYNC_QUEUE_STORE], 'readwrite');

    // Update record
    const recordStore = transaction.objectStore(RECORDS_STORE);
    const recordRequest = recordStore.get(offlineId);

    recordRequest.onsuccess = () => {
      const record = recordRequest.result;
      if (record) {
        record.syncAttempts += 1;
        record.lastSyncError = error || null;
        recordStore.put(record);
      }
    };

    // Update sync queue
    const syncStore = transaction.objectStore(SYNC_QUEUE_STORE);
    const syncRequest = syncStore.get(offlineId);

    syncRequest.onsuccess = () => {
      const item = syncRequest.result;
      if (item) {
        item.attempts += 1;
        item.lastError = error || null;
        item.status = error ? 'failed' : 'pending';
        syncStore.put(item);
      }
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

// ============================================================================
// Photo Operations
// ============================================================================

/**
 * Save a photo for an offline record
 */
export async function saveOfflinePhoto(
  recordOfflineId: string,
  photo: {
    photoType: CheckPhotoType;
    responseId?: string;
    dataUrl: string;
    latitude: number | null;
    longitude: number | null;
  }
): Promise<OfflinePhoto> {
  const db = await openDatabase();

  const offlinePhoto: OfflinePhoto & { recordOfflineId: string } = {
    id: `photo-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    recordOfflineId,
    photoType: photo.photoType,
    responseId: photo.responseId,
    dataUrl: photo.dataUrl,
    latitude: photo.latitude,
    longitude: photo.longitude,
    capturedAt: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PHOTOS_STORE, RECORDS_STORE], 'readwrite');

    // Save photo
    const photosStore = transaction.objectStore(PHOTOS_STORE);
    photosStore.put(offlinePhoto);

    // Update record's photos array
    const recordStore = transaction.objectStore(RECORDS_STORE);
    const recordRequest = recordStore.get(recordOfflineId);

    recordRequest.onsuccess = () => {
      const record = recordRequest.result;
      if (record) {
        record.photos.push({
          id: offlinePhoto.id,
          photoType: offlinePhoto.photoType,
          responseId: offlinePhoto.responseId,
          dataUrl: offlinePhoto.dataUrl,
          latitude: offlinePhoto.latitude,
          longitude: offlinePhoto.longitude,
          capturedAt: offlinePhoto.capturedAt,
        });
        recordStore.put(record);
      }
    };

    transaction.oncomplete = () => {
      db.close();
      resolve(offlinePhoto);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

/**
 * Get photos for an offline record
 */
export async function getOfflinePhotos(recordOfflineId: string): Promise<OfflinePhoto[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PHOTOS_STORE, 'readonly');
    const store = transaction.objectStore(PHOTOS_STORE);
    const index = store.index('by-record');
    const request = index.getAll(recordOfflineId);

    request.onsuccess = () => {
      db.close();
      const photos = request.result.map(({ recordOfflineId: _, ...photo }: { recordOfflineId: string } & OfflinePhoto) => photo);
      resolve(photos);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Delete an offline photo
 */
export async function deleteOfflinePhoto(photoId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([PHOTOS_STORE, RECORDS_STORE], 'readwrite');
    const photosStore = transaction.objectStore(PHOTOS_STORE);

    // Get photo first to find record
    const photoRequest = photosStore.get(photoId);

    photoRequest.onsuccess = () => {
      const photo = photoRequest.result;
      if (photo) {
        // Remove from record's photos array
        const recordStore = transaction.objectStore(RECORDS_STORE);
        const recordRequest = recordStore.get(photo.recordOfflineId);

        recordRequest.onsuccess = () => {
          const record = recordRequest.result;
          if (record) {
            record.photos = record.photos.filter((p: OfflinePhoto) => p.id !== photoId);
            recordStore.put(record);
          }
        };

        // Delete photo
        photosStore.delete(photoId);
      }
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

// ============================================================================
// Sync Queue Operations
// ============================================================================

interface SyncQueueItem {
  offlineId: string;
  status: 'pending' | 'syncing' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/**
 * Get pending sync items
 */
export async function getPendingSyncItems(): Promise<string[]> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, 'readonly');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      const items = request.result as SyncQueueItem[];
      const pending = items
        .filter((item) => item.status === 'pending' || item.status === 'failed')
        .map((item) => item.offlineId);
      resolve(pending);
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Get sync queue status
 */
export async function getSyncQueueStatus(): Promise<{
  pending: number;
  syncing: number;
  failed: number;
}> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, 'readonly');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      const items = request.result as SyncQueueItem[];
      resolve({
        pending: items.filter((i) => i.status === 'pending').length,
        syncing: items.filter((i) => i.status === 'syncing').length,
        failed: items.filter((i) => i.status === 'failed').length,
      });
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

/**
 * Mark item as syncing
 */
export async function markAsSyncing(offlineId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
    const store = transaction.objectStore(SYNC_QUEUE_STORE);
    const request = store.get(offlineId);

    request.onsuccess = () => {
      const item = request.result;
      if (item) {
        item.status = 'syncing';
        store.put(item);
      }
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

/**
 * Mark item as synced (and remove from queue)
 */
export async function markAsSynced(offlineId: string): Promise<void> {
  await deleteOfflineRecord(offlineId);
}

// ============================================================================
// Clear All Data
// ============================================================================

/**
 * Clear all offline data (use with caution!)
 */
export async function clearAllOfflineData(): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([RECORDS_STORE, PHOTOS_STORE, SYNC_QUEUE_STORE], 'readwrite');

    transaction.objectStore(RECORDS_STORE).clear();
    transaction.objectStore(PHOTOS_STORE).clear();
    transaction.objectStore(SYNC_QUEUE_STORE).clear();

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

// ============================================================================
// Export for React hooks
// ============================================================================

export const offlineStorage = {
  // Utils
  generateOfflineId,
  isOnline,

  // Records
  saveOfflineRecord,
  getOfflineRecords,
  getOfflineRecordsForVehicle,
  getOfflineRecord,
  deleteOfflineRecord,
  updateOfflineRecordSyncStatus,

  // Photos
  saveOfflinePhoto,
  getOfflinePhotos,
  deleteOfflinePhoto,

  // Sync Queue
  getPendingSyncItems,
  getSyncQueueStatus,
  markAsSyncing,
  markAsSynced,

  // Clear
  clearAllOfflineData,
};
