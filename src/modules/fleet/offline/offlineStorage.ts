/**
 * Fleet Offline Storage Service
 * Handles IndexedDB operations for offline data persistence
 */

const DB_NAME = 'FleetOfflineDB';
const DB_VERSION = 1;

// Store names
export const STORES = {
  FUEL_TRANSACTIONS: 'pendingFuelTransactions',
  CHECK_INS: 'pendingCheckIns',
  PHOTOS: 'pendingPhotos',
  SYNC_QUEUE: 'syncQueue',
} as const;

export interface PendingFuelTransaction {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  transactionDate: string;
  amountRand: number;
  litres: number;
  pricePerLitre?: number;
  odometerReading?: number;
  stationName?: string;
  receiptPhotoId?: string;
  odometerPhotoId?: string;
  gpsLat?: number;
  gpsLng?: number;
  captureTimestamp: string;
  driverName?: string;
  createdAt: string;
  syncStatus: 'pending' | 'syncing' | 'failed';
  syncAttempts: number;
  lastSyncError?: string;
}

export interface PendingCheckIn {
  id: string;
  vehicleId: string;
  vehicleRegistration: string;
  checkType: 'daily' | 'weekly';
  checkDate: string;
  driverName: string;
  odometerReading?: number;
  fuelLevel?: number;
  photoIds: string[];
  checklistResponses?: Record<string, unknown>;
  gpsLat?: number;
  gpsLng?: number;
  captureTimestamp: string;
  createdAt: string;
  syncStatus: 'pending' | 'syncing' | 'failed';
  syncAttempts: number;
  lastSyncError?: string;
}

export interface PendingPhoto {
  id: string;
  parentId: string; // Links to fuel transaction or check-in
  parentType: 'fuel' | 'checkin';
  photoType: string; // 'receipt', 'odometer', 'dashboard', 'fuel_gauge', etc.
  blob: Blob;
  mimeType: string;
  fileName: string;
  gpsLat?: number;
  gpsLng?: number;
  capturedAt: string;
  createdAt: string;
}

export interface SyncQueueItem {
  id: string;
  type: 'fuel' | 'checkin';
  itemId: string;
  priority: number; // Lower = higher priority
  createdAt: string;
  status: 'pending' | 'syncing' | 'failed';
}

class OfflineStorageService {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[OfflineStorage] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('[OfflineStorage] Database opened successfully');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        console.log('[OfflineStorage] Upgrading database schema');

        // Pending fuel transactions store
        if (!db.objectStoreNames.contains(STORES.FUEL_TRANSACTIONS)) {
          const fuelStore = db.createObjectStore(STORES.FUEL_TRANSACTIONS, { keyPath: 'id' });
          fuelStore.createIndex('vehicleId', 'vehicleId', { unique: false });
          fuelStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          fuelStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Pending check-ins store
        if (!db.objectStoreNames.contains(STORES.CHECK_INS)) {
          const checkInStore = db.createObjectStore(STORES.CHECK_INS, { keyPath: 'id' });
          checkInStore.createIndex('vehicleId', 'vehicleId', { unique: false });
          checkInStore.createIndex('syncStatus', 'syncStatus', { unique: false });
          checkInStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Pending photos store (stores blobs)
        if (!db.objectStoreNames.contains(STORES.PHOTOS)) {
          const photoStore = db.createObjectStore(STORES.PHOTOS, { keyPath: 'id' });
          photoStore.createIndex('parentId', 'parentId', { unique: false });
          photoStore.createIndex('parentType', 'parentType', { unique: false });
        }

        // Sync queue store
        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const queueStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
          queueStore.createIndex('status', 'status', { unique: false });
          queueStore.createIndex('priority', 'priority', { unique: false });
          queueStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
    });

    return this.dbPromise;
  }

  /**
   * Get the database instance
   */
  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  // ==================== Fuel Transactions ====================

  async saveFuelTransaction(transaction: PendingFuelTransaction): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.FUEL_TRANSACTIONS, STORES.SYNC_QUEUE], 'readwrite');

      // Save transaction
      const fuelStore = tx.objectStore(STORES.FUEL_TRANSACTIONS);
      fuelStore.put(transaction);

      // Add to sync queue
      const queueStore = tx.objectStore(STORES.SYNC_QUEUE);
      const queueItem: SyncQueueItem = {
        id: `fuel-${transaction.id}`,
        type: 'fuel',
        itemId: transaction.id,
        priority: 1,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      queueStore.put(queueItem);

      tx.oncomplete = () => {
        console.log('[OfflineStorage] Fuel transaction saved:', transaction.id);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getFuelTransaction(id: string): Promise<PendingFuelTransaction | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.FUEL_TRANSACTIONS, 'readonly');
      const store = tx.objectStore(STORES.FUEL_TRANSACTIONS);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPendingFuelTransactions(): Promise<PendingFuelTransaction[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.FUEL_TRANSACTIONS, 'readonly');
      const store = tx.objectStore(STORES.FUEL_TRANSACTIONS);
      const index = store.index('syncStatus');
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteFuelTransaction(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.FUEL_TRANSACTIONS, STORES.SYNC_QUEUE, STORES.PHOTOS], 'readwrite');

      // Delete transaction
      tx.objectStore(STORES.FUEL_TRANSACTIONS).delete(id);

      // Delete from sync queue
      tx.objectStore(STORES.SYNC_QUEUE).delete(`fuel-${id}`);

      // Delete associated photos
      const photoStore = tx.objectStore(STORES.PHOTOS);
      const photoIndex = photoStore.index('parentId');
      const photoCursor = photoIndex.openCursor(IDBKeyRange.only(id));
      photoCursor.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==================== Check-Ins ====================

  async saveCheckIn(checkIn: PendingCheckIn): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.CHECK_INS, STORES.SYNC_QUEUE], 'readwrite');

      // Save check-in
      const checkInStore = tx.objectStore(STORES.CHECK_INS);
      checkInStore.put(checkIn);

      // Add to sync queue
      const queueStore = tx.objectStore(STORES.SYNC_QUEUE);
      const queueItem: SyncQueueItem = {
        id: `checkin-${checkIn.id}`,
        type: 'checkin',
        itemId: checkIn.id,
        priority: 0, // Check-ins have higher priority
        createdAt: new Date().toISOString(),
        status: 'pending',
      };
      queueStore.put(queueItem);

      tx.oncomplete = () => {
        console.log('[OfflineStorage] Check-in saved:', checkIn.id);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getCheckIn(id: string): Promise<PendingCheckIn | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CHECK_INS, 'readonly');
      const store = tx.objectStore(STORES.CHECK_INS);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPendingCheckIns(): Promise<PendingCheckIn[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CHECK_INS, 'readonly');
      const store = tx.objectStore(STORES.CHECK_INS);
      const index = store.index('syncStatus');
      const request = index.getAll('pending');
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteCheckIn(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.CHECK_INS, STORES.SYNC_QUEUE, STORES.PHOTOS], 'readwrite');

      tx.objectStore(STORES.CHECK_INS).delete(id);
      tx.objectStore(STORES.SYNC_QUEUE).delete(`checkin-${id}`);

      // Delete associated photos
      const photoStore = tx.objectStore(STORES.PHOTOS);
      const photoIndex = photoStore.index('parentId');
      const photoCursor = photoIndex.openCursor(IDBKeyRange.only(id));
      photoCursor.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==================== Photos ====================

  async savePhoto(photo: PendingPhoto): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.PHOTOS, 'readwrite');
      const store = tx.objectStore(STORES.PHOTOS);
      store.put(photo);
      tx.oncomplete = () => {
        console.log('[OfflineStorage] Photo saved:', photo.id);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async getPhoto(id: string): Promise<PendingPhoto | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.PHOTOS, 'readonly');
      const store = tx.objectStore(STORES.PHOTOS);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getPhotosByParent(parentId: string): Promise<PendingPhoto[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.PHOTOS, 'readonly');
      const store = tx.objectStore(STORES.PHOTOS);
      const index = store.index('parentId');
      const request = index.getAll(parentId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== Sync Queue ====================

  async getSyncQueue(): Promise<SyncQueueItem[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.SYNC_QUEUE, 'readonly');
      const store = tx.objectStore(STORES.SYNC_QUEUE);
      const index = store.index('status');
      const request = index.getAll('pending');
      request.onsuccess = () => {
        const items = request.result || [];
        // Sort by priority (lower = higher priority) then by createdAt
        items.sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority;
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        });
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateSyncQueueItem(id: string, updates: Partial<SyncQueueItem>): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_QUEUE);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          store.put({ ...item, ...updates });
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async removeSyncQueueItem(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = tx.objectStore(STORES.SYNC_QUEUE);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==================== Utilities ====================

  async getPendingCount(): Promise<number> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.SYNC_QUEUE, 'readonly');
      const store = tx.objectStore(STORES.SYNC_QUEUE);
      const index = store.index('status');
      const request = index.count('pending');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORES.FUEL_TRANSACTIONS, STORES.CHECK_INS, STORES.PHOTOS, STORES.SYNC_QUEUE],
        'readwrite'
      );

      tx.objectStore(STORES.FUEL_TRANSACTIONS).clear();
      tx.objectStore(STORES.CHECK_INS).clear();
      tx.objectStore(STORES.PHOTOS).clear();
      tx.objectStore(STORES.SYNC_QUEUE).clear();

      tx.oncomplete = () => {
        console.log('[OfflineStorage] All data cleared');
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}

// Export singleton instance
export const offlineStorage = new OfflineStorageService();
