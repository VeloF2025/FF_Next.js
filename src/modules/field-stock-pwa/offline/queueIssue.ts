/**
 * IndexedDB queue for /my/stores field-stock issue submissions.
 *
 * Mirrors src/modules/attendance/portal/client/offline/db.ts exactly —
 * raw IDB (no `idb` wrapper) since that package is not in package.json.
 * The plan's verbatim code assumed `idb` would be added; we mirror the
 * attendance raw-IDB pattern instead.
 *
 * DB name: 'field-stock-pwa-v1'  (distinct from 'AttendanceOfflineDB' so the
 * two modules never share quota or risk key collisions).
 *
 * Object store: 'pending-issues', keyPath: 'id' (uuid generated client-side).
 */

// 🟢 WORKING: raw-IDB pattern mirrors attendance/portal/client/offline/db.ts

import type { PwaIssueDraft } from '../types';

const DB_NAME = 'field-stock-pwa-v1';
const DB_VERSION = 1;
const STORE = 'pending-issues';

/** A single queued issue waiting to be submitted when the device comes online. */
export interface QueuedIssue {
  /** UUID generated client-side at enqueue time. */
  id: string;
  draft: PwaIssueDraft;
  /** Epoch ms — used for oldest-first ordering during drain. */
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

/** Singleton promise so concurrent callers share one `open` request. */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable in this environment'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onblocked = () =>
      reject(new Error('IDB open blocked — another tab holds an older version'));
  });
  return dbPromise;
}

function tx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const store = transaction.objectStore(STORE);
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

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB request failed'));
  });
}

// =============================================================================
// Public queue API
// =============================================================================

/**
 * Add a draft to the offline queue.
 *
 * @returns The generated UUID that identifies this queued entry.
 */
export async function enqueueIssue(draft: PwaIssueDraft): Promise<string> {
  const id = crypto.randomUUID();
  const entry: QueuedIssue = { id, draft, enqueuedAt: Date.now(), attempts: 0 };
  await tx('readwrite', (s) => promisifyRequest(s.put(entry)));
  return id;
}

/** Return all queued issues, oldest-first (sorted by `enqueuedAt`). */
export async function listQueued(): Promise<QueuedIssue[]> {
  return tx('readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<QueuedIssue[]>);
    return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  });
}

/** Remove a queued issue permanently (call on 2xx from the server). */
export async function dropQueued(id: string): Promise<void> {
  await tx('readwrite', (s) => promisifyRequest(s.delete(id)));
}

/**
 * Read-modify-write inside one transaction so two concurrent drain passes
 * don't race their `attempts` counter.
 *
 * Callers: invoke on any non-2xx server response; the sync hook decides
 * whether to also drop permanently after MAX_ATTEMPTS.
 */
export async function bumpAttempt(id: string, error: string): Promise<void> {
  await tx('readwrite', async (s) => {
    const row = await promisifyRequest(s.get(id) as IDBRequest<QueuedIssue | undefined>);
    if (!row) return;
    await promisifyRequest(s.put({ ...row, attempts: row.attempts + 1, lastError: error }));
  });
}

// =============================================================================
// Test helper
// =============================================================================

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
