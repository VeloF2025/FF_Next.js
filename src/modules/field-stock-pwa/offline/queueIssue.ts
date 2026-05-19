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
 * Object stores:
 *   - 'pending-issues'  keyPath: 'id' — items waiting to sync
 *   - 'abandoned-issues' keyPath: 'id' — items that hit MAX_ATTEMPTS on 4xx;
 *     retained for manual review by the stores person.
 *
 * Version history:
 *   v1 — initial schema (PwaIssueDraft lacked sourceLocationId/destinationLocationId)
 *   v2 — PwaIssueDraft now requires sourceLocationId + destinationLocationId.
 *        Stale v1 queued items would be missing these FK columns and corrupt the
 *        picking if drained. Strategy: purge the entire object store on upgrade
 *        (deleteObjectStore + recreate). Any queued v1 items are lost — safer than
 *        draining them with garbage location IDs. The stores flow is short enough
 *        that an offline-queued item is unlikely to survive a full app reload.
 *   v3 — Adds 'abandoned-issues' store. ADDITIVE migration: pending-issues items
 *        are preserved unchanged. Only the new store is created.
 */

// 🟢 WORKING: raw-IDB pattern mirrors attendance/portal/client/offline/db.ts

import type { PwaIssueDraft } from '../types';

const DB_NAME = 'field-stock-pwa-v1';
const DB_VERSION = 3;
const STORE = 'pending-issues';
const ABANDONED_STORE = 'abandoned-issues';

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

/**
 * A permanently-failed queued issue, moved here after MAX_ATTEMPTS on a 4xx
 * response. Retained on-device so the stores person can see what happened
 * and re-issue manually if needed.
 *
 * Unlike pending-issues, abandoned items are NEVER auto-retried. They grow
 * unbounded until explicitly dismissed via clearAbandoned(id).
 * Future: add auto-archive after 30 days (separate ticket).
 */
export interface AbandonedIssue {
  /** The original queue UUID. */
  id: string;
  draft: PwaIssueDraft;
  /** Epoch ms when the issue was first enqueued. */
  enqueuedAt: number;
  /** Epoch ms when it was moved to abandoned. */
  abandonedAt: number;
  attempts: number;
  lastError: string;
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
    req.onupgradeneeded = (event) => {
      const d = req.result;
      // v1 → v2: purge stale pending-issues items that lacked required location IDs.
      // deleteObjectStore + recreate was the safest approach — v1 items had
      // no sourceLocationId / destinationLocationId and would corrupt pickings.
      if (event.oldVersion < 2 && d.objectStoreNames.contains(STORE)) {
        d.deleteObjectStore(STORE);
      }
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' });
      }
      // v2 → v3: ADDITIVE — only add the abandoned-issues store.
      // Existing pending-issues items are preserved unchanged.
      if (!d.objectStoreNames.contains(ABANDONED_STORE)) {
        d.createObjectStore(ABANDONED_STORE, { keyPath: 'id' });
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
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T
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
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.put(entry)));
  return id;
}

/** Return all queued issues, oldest-first (sorted by `enqueuedAt`). */
export async function listQueued(): Promise<QueuedIssue[]> {
  return tx(STORE, 'readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<QueuedIssue[]>);
    return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  });
}

/** Remove a queued issue permanently (call on 2xx from the server). */
export async function dropQueued(id: string): Promise<void> {
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.delete(id)));
}

/**
 * Read-modify-write inside one transaction so two concurrent drain passes
 * don't race their `attempts` counter.
 *
 * Callers: invoke on any non-2xx server response; the sync hook decides
 * whether to also drop permanently after MAX_ATTEMPTS.
 */
export async function bumpAttempt(id: string, error: string): Promise<void> {
  await tx(STORE, 'readwrite', async (s) => {
    const row = await promisifyRequest(s.get(id) as IDBRequest<QueuedIssue | undefined>);
    if (!row) return;
    await promisifyRequest(s.put({ ...row, attempts: row.attempts + 1, lastError: error }));
  });
}

// =============================================================================
// Abandoned-issues store — permanently-failed queue items
// =============================================================================

/**
 * Move a queued item to the abandoned-issues store.
 *
 * The write to abandoned-issues is done first; only if that succeeds is the
 * item deleted from pending-issues. This prevents silent data loss if either
 * step fails mid-way.
 *
 * Called by useStockSync when MAX_ATTEMPTS is hit on a 4xx error.
 */
export async function abandonIssue(item: QueuedIssue): Promise<void> {
  const abandoned: AbandonedIssue = {
    id: item.id,
    draft: item.draft,
    enqueuedAt: item.enqueuedAt,
    abandonedAt: Date.now(),
    attempts: item.attempts,
    lastError: item.lastError ?? 'Unknown error',
  };
  await tx(ABANDONED_STORE, 'readwrite', (s) =>
    promisifyRequest(s.put(abandoned))
  );
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.delete(item.id)));
}

/** Return all abandoned issues, newest-first (most recently abandoned first). */
export async function listAbandoned(): Promise<AbandonedIssue[]> {
  return tx(ABANDONED_STORE, 'readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<AbandonedIssue[]>);
    return all.sort((a, b) => b.abandonedAt - a.abandonedAt);
  });
}

/**
 * Remove a single abandoned issue from the audit store.
 *
 * Called when the stores person has handled the item manually and wants to
 * dismiss it from the banner.
 */
export async function clearAbandoned(id: string): Promise<void> {
  await tx(ABANDONED_STORE, 'readwrite', (s) => promisifyRequest(s.delete(id)));
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
