/**
 * Generic IndexedDB queue store: pending + dropped object stores, one database
 * per queueName. A direct generalisation of
 * src/modules/attendance/portal/client/offline/db.ts — same transaction
 * discipline (race-safe attempts bump, drop = write-dropped-then-delete-pending),
 * same safety caps, made generic over the payload type.
 */

import { QueueFullError, QuotaExceededError, type DroppedItem, type QueuedItem } from './types';

const PENDING = 'pending';
const DROPPED = 'dropped';
const DB_VERSION = 1;

/** Reject an enqueue once the browser's projected storage usage would cross
 *  this fraction of its quota — a soft guard *before* IndexedDB throws its own
 *  QuotaExceededError under real pressure. */
const STORAGE_SAFETY_FRACTION = 0.8;

/** Best-effort read of the browser's storage estimate. Returns null when the
 *  API is absent or throws — the caller treats that as "pass the byte-budget
 *  check only", never as a hard block that would strand a legitimate item. */
async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage?.estimate) return null;
    const { usage, quota } = await storage.estimate();
    if (typeof usage === 'number' && typeof quota === 'number') return { usage, quota };
  } catch {
    // API unavailable / rejected — fall through to "unavailable".
  }
  return null;
}

export class OfflineQueueStore<TPayload> {
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly dbName: string,
    private readonly maxQueueSize = 50,
    /** When set, total pending `byteSize` may not exceed this. Undefined = no
     *  byte cap (count cap only). */
    private readonly maxQueueBytes?: number
  ) {}

  private openDb(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      return Promise.reject(new Error('IndexedDB unavailable in this environment'));
    }
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PENDING)) {
          db.createObjectStore(PENDING, { keyPath: 'id' }).createIndex('queuedAt', 'queuedAt');
        }
        if (!db.objectStoreNames.contains(DROPPED)) {
          db.createObjectStore(DROPPED, { keyPath: 'id' }).createIndex('droppedAt', 'droppedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
      req.onblocked = () => reject(new Error('IDB open blocked — another tab holds an older version'));
    });
    return this.dbPromise;
  }

  private tx<T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => Promise<T> | T
  ): Promise<T> {
    return this.openDb().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          let result: T;
          Promise.resolve(fn(store)).then((r) => { result = r; }).catch(reject);
          transaction.oncomplete = () => resolve(result);
          transaction.onerror = () => reject(transaction.error ?? new Error('IDB tx failed'));
          transaction.onabort = () => reject(transaction.error ?? new Error('IDB tx aborted'));
        })
    );
  }

  private req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IDB request failed'));
    });
  }

  async enqueue(item: QueuedItem<TPayload>): Promise<void> {
    const count = await this.countPending();
    if (count >= this.maxQueueSize) throw new QueueFullError(count);
    if (this.maxQueueBytes !== undefined) {
      await this.assertByteBudget(item.byteSize ?? 0);
    }
    await this.tx(PENDING, 'readwrite', (s) => this.req(s.add(item)));
  }

  /** Sum `byteSize` across all pending rows via a cursor. Derived accounting —
   *  never a persisted counter that could drift from the actual rows. */
  async sumPendingBytes(): Promise<number> {
    return this.tx(
      PENDING,
      'readonly',
      (s) =>
        new Promise<number>((resolve, reject) => {
          let total = 0;
          const cursorReq = s.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
              total += (cursor.value as QueuedItem<TPayload>).byteSize ?? 0;
              cursor.continue();
            } else {
              resolve(total);
            }
          };
          cursorReq.onerror = () => reject(cursorReq.error ?? new Error('IDB cursor failed'));
        })
    );
  }

  /** Throw QuotaExceededError if adding `addBytes` would breach the byte budget
   *  OR push projected browser storage past the safety fraction. */
  private async assertByteBudget(addBytes: number): Promise<void> {
    const budget = this.maxQueueBytes as number;
    const current = await this.sumPendingBytes();
    if (current + addBytes > budget) {
      throw new QuotaExceededError(current, addBytes, budget);
    }
    const est = await estimateStorage();
    if (est && est.quota > 0 && (est.usage + addBytes) / est.quota > STORAGE_SAFETY_FRACTION) {
      throw new QuotaExceededError(est.usage, addBytes, est.quota);
    }
  }

  async listPending(): Promise<QueuedItem<TPayload>[]> {
    return this.tx(PENDING, 'readonly', async (s) => {
      const rows = await this.req(s.getAll() as IDBRequest<QueuedItem<TPayload>[]>);
      return rows.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    });
  }

  async countPending(): Promise<number> {
    return this.tx(PENDING, 'readonly', (s) => this.req(s.count()));
  }

  async deletePending(id: string): Promise<void> {
    await this.tx(PENDING, 'readwrite', (s) => this.req(s.delete(id)));
  }

  /** Read-modify-write in one transaction so concurrent flushes can't race. */
  async bumpAttempts(id: string, lastError: string): Promise<void> {
    await this.tx(PENDING, 'readwrite', async (s) => {
      const row = await this.req(s.get(id) as IDBRequest<QueuedItem<TPayload> | undefined>);
      if (!row) return;
      await this.req(s.put({ ...row, attempts: row.attempts + 1, lastError }));
    });
  }

  /** Move pending → dropped. Write dropped first, then delete pending, so
   *  nothing silently vanishes if a step fails. */
  async drop(item: QueuedItem<TPayload>, dropReason: string): Promise<void> {
    const dropped: DroppedItem<TPayload> = {
      ...item,
      droppedAt: new Date().toISOString(),
      dropReason,
    };
    await this.tx(DROPPED, 'readwrite', (s) => this.req(s.put(dropped)));
    await this.deletePending(item.id);
  }

  async listDropped(): Promise<DroppedItem<TPayload>[]> {
    return this.tx(DROPPED, 'readonly', async (s) => {
      const rows = await this.req(s.getAll() as IDBRequest<DroppedItem<TPayload>[]>);
      return rows.sort((a, b) => b.droppedAt.localeCompare(a.droppedAt));
    });
  }

  async acknowledgeDropped(id: string): Promise<void> {
    await this.tx(DROPPED, 'readwrite', (s) => this.req(s.delete(id)));
  }

  /** Test-only: drop and recreate the DB so each test starts clean. */
  async __resetForTests(): Promise<void> {
    if (this.dbPromise) {
      (await this.dbPromise).close();
      this.dbPromise = null;
    }
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(this.dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error ?? new Error('delete failed'));
      req.onblocked = () => reject(new Error('IDB delete blocked — close other handles first'));
    });
  }
}
