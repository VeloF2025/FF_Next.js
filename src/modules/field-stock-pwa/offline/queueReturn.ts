/**
 * IndexedDB queue for /my/stores/return submissions.
 *
 * Mirrors queueIssue.ts; shares IDB primitives via ./db.ts so both queues live
 * in the same 'field-stock-pwa-v1' database and share one IDBDatabase handle.
 *
 * Stores:
 *  - 'pending-returns'   keyPath: 'id' — returns waiting to sync
 *  - 'abandoned-returns' keyPath: 'id' — returns that hit MAX_ATTEMPTS on 4xx;
 *     retained for manual review by the stores person.
 */

// 🟢 WORKING: mirrors queueIssue.ts — shares db.ts primitives

import type { PwaReturnDraft } from '../types';
import { tx, promisifyRequest, STORES } from './db';

const STORE = STORES.pendingReturns;
const ABANDONED_STORE = STORES.abandonedReturns;

/** A single queued return waiting to be submitted when the device comes online. */
export interface QueuedReturn {
  /** UUID generated client-side at enqueue time. */
  id: string;
  draft: PwaReturnDraft;
  /** Epoch ms — used for oldest-first ordering during drain. */
  enqueuedAt: number;
  attempts: number;
  lastError?: string;
}

/**
 * A permanently-failed queued return, moved here after MAX_ATTEMPTS on a 4xx
 * response. Retained on-device so the stores person can see what happened
 * and re-submit manually if needed.
 *
 * Unlike pending-returns, abandoned items are NEVER auto-retried. They grow
 * unbounded until explicitly dismissed via clearAbandonedReturn(id).
 * Future: add auto-archive after 30 days (separate ticket).
 */
export interface AbandonedReturn {
  /** The original queue UUID. */
  id: string;
  draft: PwaReturnDraft;
  /** Epoch ms when the return was first enqueued. */
  enqueuedAt: number;
  /** Epoch ms when it was moved to abandoned. */
  abandonedAt: number;
  attempts: number;
  lastError: string;
}

// =============================================================================
// Public queue API
// =============================================================================

/**
 * Add a return draft to the offline queue.
 *
 * @returns The generated UUID that identifies this queued entry.
 */
export async function enqueueReturn(draft: PwaReturnDraft): Promise<string> {
  const id = crypto.randomUUID();
  const entry: QueuedReturn = { id, draft, enqueuedAt: Date.now(), attempts: 0 };
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.put(entry)));
  return id;
}

/** Return all queued returns, oldest-first (sorted by `enqueuedAt`). */
export async function listQueuedReturns(): Promise<QueuedReturn[]> {
  return tx(STORE, 'readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<QueuedReturn[]>);
    return all.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  });
}

/** Remove a queued return permanently (call on 2xx from the server). */
export async function dropQueuedReturn(id: string): Promise<void> {
  await tx(STORE, 'readwrite', (s) => promisifyRequest(s.delete(id)));
}

/**
 * Read-modify-write inside one transaction so two concurrent drain passes
 * don't race their `attempts` counter.
 *
 * Callers: invoke on any non-2xx server response; the sync hook decides
 * whether to also drop permanently after MAX_ATTEMPTS.
 */
export async function bumpReturnAttempt(id: string, error: string): Promise<void> {
  await tx(STORE, 'readwrite', async (s) => {
    const row = await promisifyRequest(
      s.get(id) as IDBRequest<QueuedReturn | undefined>
    );
    if (!row) return;
    await promisifyRequest(
      s.put({ ...row, attempts: row.attempts + 1, lastError: error })
    );
  });
}

// =============================================================================
// Abandoned-returns store — permanently-failed queue items
// =============================================================================

/**
 * Move a queued return to the abandoned-returns store.
 *
 * The write to abandoned-returns is done first; only if that succeeds is the
 * item deleted from pending-returns. This prevents silent data loss if either
 * step fails mid-way.
 *
 * Called by useStockSync when MAX_ATTEMPTS is hit on a 4xx error.
 */
export async function abandonReturn(item: QueuedReturn): Promise<void> {
  const abandoned: AbandonedReturn = {
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

/** Return all abandoned returns, newest-first (most recently abandoned first). */
export async function listAbandonedReturns(): Promise<AbandonedReturn[]> {
  return tx(ABANDONED_STORE, 'readonly', async (s) => {
    const all = await promisifyRequest(s.getAll() as IDBRequest<AbandonedReturn[]>);
    return all.sort((a, b) => b.abandonedAt - a.abandonedAt);
  });
}

/**
 * Remove a single abandoned return from the audit store.
 *
 * Called when the stores person has handled the item manually and wants to
 * dismiss it from the banner.
 */
export async function clearAbandonedReturn(id: string): Promise<void> {
  await tx(ABANDONED_STORE, 'readwrite', (s) =>
    promisifyRequest(s.delete(id))
  );
}
