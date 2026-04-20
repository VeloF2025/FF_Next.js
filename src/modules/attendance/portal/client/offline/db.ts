/**
 * IndexedDB queue for /my attendance clock events.
 *
 * Two object stores:
 *   - pendingClockEvents — events waiting to sync
 *   - droppedClockEvents — events we permanently dropped (attempts cap,
 *     unrecoverable server response). Retained on-device so a staff member
 *     or supervisor can see what happened and raise a dispute — without
 *     this store, an ephemeral toast was the only evidence a shift got
 *     dropped.
 *
 * Database name is distinct ('AttendanceOfflineDB') so devices used for
 * both portals don't share storage quota or risk key collisions.
 */

const DB_NAME = 'AttendanceOfflineDB';
const DB_VERSION = 2;
const STORE = 'pendingClockEvents';
const DROPPED_STORE = 'droppedClockEvents';

/** Upper bound on queue depth. Prevents a phone that's been out of range
 *  for weeks from hitting IDB quota silently — the enqueue call throws a
 *  typed error the UI must handle explicitly. */
export const MAX_QUEUE_SIZE = 50;

export type ClockAction = 'in' | 'out';

export interface PendingClockEvent {
  id: string;
  action: ClockAction;
  lat: number;
  lon: number;
  accuracyM: number;
  clientOccurredAt: string;
  selfieBase64: string;
  deviceFingerprint?: string;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

export interface DroppedClockEvent extends PendingClockEvent {
  droppedAt: string;
  dropReason: string;
}

export class QueueFullError extends Error {
  constructor(size: number) {
    super(`Offline queue is full (${size} events). Find signal before clocking again.`);
    this.name = 'QueueFullError';
  }
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
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' });
        s.createIndex('queuedAt', 'queuedAt');
      }
      if (!db.objectStoreNames.contains(DROPPED_STORE)) {
        const s = db.createObjectStore(DROPPED_STORE, { keyPath: 'id' });
        s.createIndex('droppedAt', 'droppedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onblocked = () => reject(new Error('IDB open blocked — another tab holds an older version'));
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
        transaction.onerror = () => reject(transaction.error ?? new Error('IDB tx failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IDB tx aborted'));
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
// Pending queue
// =============================================================================

export async function enqueueClockEvent(event: PendingClockEvent): Promise<void> {
  const count = await countPendingClockEvents();
  if (count >= MAX_QUEUE_SIZE) {
    throw new QueueFullError(count);
  }
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.add(event)));
}

export async function listPendingClockEvents(): Promise<PendingClockEvent[]> {
  return tx(STORE, 'readonly', async (s) => {
    const events = await promisifyRequest(s.getAll() as IDBRequest<PendingClockEvent[]>);
    return events.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  });
}

export async function countPendingClockEvents(): Promise<number> {
  return tx(STORE, 'readonly', (s) => promisifyRequest(s.count()));
}

export async function deletePendingClockEvent(id: string): Promise<void> {
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.delete(id)));
}

/**
 * Read-modify-write inside one transaction so two concurrent flushes don't
 * race their attempts counter.
 */
export async function bumpPendingClockEventAttempts(id: string, lastError: string): Promise<void> {
  await tx(STORE, 'readwrite', async (s) => {
    const row = await promisifyRequest(s.get(id) as IDBRequest<PendingClockEvent | undefined>);
    if (!row) return;
    await promisifyRequest(s.put({ ...row, attempts: row.attempts + 1, lastError }));
  });
}

// =============================================================================
// Dropped-event persistence
// =============================================================================

/** Move a pending event to the dropped store in one logical step. If the
 *  dropped-store write succeeds, we delete from pending; if either step
 *  fails, nothing silently vanishes. */
export async function dropPendingClockEvent(
  event: PendingClockEvent,
  dropReason: string
): Promise<void> {
  const dropped: DroppedClockEvent = {
    ...event,
    droppedAt: new Date().toISOString(),
    dropReason,
  };
  await tx(DROPPED_STORE, 'readwrite', (s) => promisifyRequest(s.put(dropped)));
  await deletePendingClockEvent(event.id);
}

export async function listDroppedClockEvents(): Promise<DroppedClockEvent[]> {
  return tx(DROPPED_STORE, 'readonly', async (s) => {
    const events = await promisifyRequest(s.getAll() as IDBRequest<DroppedClockEvent[]>);
    return events.sort((a, b) => b.droppedAt.localeCompare(a.droppedAt));
  });
}

export async function acknowledgeDroppedClockEvent(id: string): Promise<void> {
  await tx(DROPPED_STORE, 'readwrite', (s) => promisifyRequest(s.delete(id)));
}

// =============================================================================
// Test helpers
// =============================================================================

/** Test-only: drop and recreate the DB so each test starts clean. */
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
    // `onblocked` here means another tab/test is still holding a handle —
    // fail the reset so the test surfaces it rather than picking up stale state.
    req.onblocked = () => reject(new Error('IDB delete blocked — close other handles first'));
  });
}
