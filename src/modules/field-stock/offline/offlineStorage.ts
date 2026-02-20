/**
 * Offline Storage for Field Stock Portal
 * IndexedDB-backed storage for pending operations when the device is offline.
 * Operations are queued here and flushed to the server on reconnection.
 */

import { log } from '@/lib/logger';

const DB_NAME = 'ff-stock-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending_operations';

/** The set of operation types that can be queued offline */
type OperationType = 'consumption' | 'picking' | 'return' | 'serial_register';

export interface PendingOperation {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Operation category used to route replay to the correct API endpoint */
  type: OperationType;
  /** Serialisable payload forwarded to the API on sync */
  data: Record<string, unknown>;
  /** ISO timestamp of when the operation was enqueued */
  createdAt: string;
  /** Number of times sync has been attempted for this operation */
  retries: number;
}

class OfflineStorage {
  private db: IDBDatabase | null = null;

  /** Lazily opens the IndexedDB database and creates the object store if needed */
  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => {
        log.error('Failed to open offline DB', { error: request.error }, 'offline-storage');
        reject(request.error);
      };
    });
  }

  /**
   * Enqueue a new pending operation.
   * @returns The generated UUID for the new operation.
   */
  async addOperation(
    op: Omit<PendingOperation, 'id' | 'createdAt' | 'retries'>
  ): Promise<string> {
    await this.init();

    const id = crypto.randomUUID();
    const operation: PendingOperation = {
      ...op,
      id,
      createdAt: new Date().toISOString(),
      retries: 0,
    };

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).add(operation);
      tx.oncomplete = () => resolve(id);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Returns all pending operations in insertion order */
  async getAll(): Promise<PendingOperation[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result as PendingOperation[]);
      request.onerror = () => reject(request.error);
    });
  }

  /** Remove a successfully synced operation by its ID */
  async remove(id: string): Promise<void> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Returns the number of pending operations awaiting sync */
  async count(): Promise<number> {
    await this.init();

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result as number);
      request.onerror = () => reject(request.error);
    });
  }
}

/** Singleton offline storage instance shared across the field-stock module */
export const offlineStorage = new OfflineStorage();
