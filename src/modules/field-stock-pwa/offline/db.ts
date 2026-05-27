/**
 * Shared IndexedDB primitives for the field-stock PWA offline queues.
 *
 * Both queueIssue.ts and queueReturn.ts route their reads/writes through here
 * so they share a single IDBDatabase handle on 'field-stock-pwa-v1'.
 *
 * Schema version history:
 *   v1 — pending-issues store
 *   v2 — purge stale v1 pending-issues (location IDs added to draft shape)
 *   v3 — additive: abandoned-issues store
 *   v4 — additive: pending-returns + abandoned-returns stores (Phase 3)
 */

// 🟢 WORKING: raw-IDB pattern mirrors attendance/portal/client/offline/db.ts

const DB_NAME = 'field-stock-pwa-v1';
const DB_VERSION = 4;

export const STORES = {
  pendingIssues: 'pending-issues',
  abandonedIssues: 'abandoned-issues',
  pendingReturns: 'pending-returns',
  abandonedReturns: 'abandoned-returns',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Singleton promise so concurrent callers share one `open` request. */
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable in this environment'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const d = req.result;
      // v1 → v2: purge stale pending-issues items that lacked required location IDs.
      if (event.oldVersion < 2 && d.objectStoreNames.contains(STORES.pendingIssues)) {
        d.deleteObjectStore(STORES.pendingIssues);
      }
      if (!d.objectStoreNames.contains(STORES.pendingIssues)) {
        d.createObjectStore(STORES.pendingIssues, { keyPath: 'id' });
      }
      // v2 → v3: ADDITIVE — only add the abandoned-issues store.
      // Existing pending-issues items are preserved unchanged.
      if (!d.objectStoreNames.contains(STORES.abandonedIssues)) {
        d.createObjectStore(STORES.abandonedIssues, { keyPath: 'id' });
      }
      // v3 → v4: ADDITIVE — add pending-returns + abandoned-returns stores (Phase 3).
      // Existing pending-issues and abandoned-issues content is preserved unchanged.
      if (!d.objectStoreNames.contains(STORES.pendingReturns)) {
        d.createObjectStore(STORES.pendingReturns, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains(STORES.abandonedReturns)) {
        d.createObjectStore(STORES.abandonedReturns, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onblocked = () =>
      reject(new Error('IDB open blocked — another tab holds an older version'));
  });
  return dbPromise;
}

export function tx<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result: T;
        Promise.resolve(fn(store))
          .then((r) => { result = r; })
          .catch(reject);
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IDB tx failed'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IDB tx aborted'));
      })
  );
}

export function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
  });
}

/** Test-only: close and delete the DB so each test starts clean. */
export async function __resetDbForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('delete failed'));
    req.onblocked = () =>
      reject(new Error('IDB delete blocked — close other handles first'));
  });
}
