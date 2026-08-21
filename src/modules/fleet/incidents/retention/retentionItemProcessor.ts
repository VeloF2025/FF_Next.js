/**
 * Working ONE retention item through storage and then the database.
 *
 * Split out of `retentionService.ts` on size: that file owns the RUN — policy,
 * preflight, time budget, finalisation — and this owns what happens to a
 * single item, which is where every irreversible step lives.
 *
 * The ordering here is the safety property. Storage objects first, then the
 * database transaction: a storage failure leaves BOTH the file and the
 * database evidence in place for a retry, and the one outcome this must never
 * produce is a deleted file with no record that it existed.
 */
import { log } from '@/lib/logger';
import type { RetentionItem } from '../analytics/types';
import { purgeIncidentRecords } from './incidentPurge';
import { getIncidentPurgeState, listIncidentStorageObjects } from './retentionRepository';
import {
  markItemFailed, markStorageComplete, recordItemAttempt, recordStorageObjectDeleted,
} from './retentionRunRepository';
import { deleteIncidentStorageObject } from './storageDeletion';

const MODULE = 'FleetRetentionItem';

/**
 * The short code recorded on a failed item, and the only thing an operator has
 * to go on when a run stalls.
 *
 * Duck-typed rather than `instanceof Error`, deliberately. `AbortSignal.timeout`
 * rejects with a DOMException named `TimeoutError`, which carries a NUMERIC
 * `code` (23) — so a string `code` is preferred first and `name` is the
 * fallback. `instanceof` additionally fails across realms: the same
 * DOMException is `instanceof Error` in plain Node but NOT under the jsdom
 * test environment, and the same is true across vm/worker boundaries. Reading
 * the property works in every realm, which is why this does not test
 * prototypes at all.
 */
export function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) return name;
  }
  return 'unknown_error';
}

/**
 * `trg_fleet_retention_item_guard` refuses any write about an incident that is
 * held or non-terminal, with 23514. That is an EXPECTED outcome of a hold
 * landing mid-run, not a crash — and critically, it also refuses the write
 * that would record the failure, so a refusal must never be routed into the
 * failure path.
 */
export function isGuardRefusal(error: unknown): boolean {
  return errorCode(error) === '23514';
}

/** A claim refused by the guard (23514) or already taken (23505) is expected too. */
export function isExpectedClaimRefusal(error: unknown): boolean {
  const code = errorCode(error);
  return code === '23514' || code === '23505';
}

export interface Totals {
  considered: number; claimed: number; completed: number; failed: number;
  skippedHold: number; skippedCoverage: number; storageDeleted: number; storagePending: number;
  stoppedForBudget: boolean;
}

async function deleteItemStorage(item: RetentionItem, totals: Totals): Promise<void> {
  // `storage_complete` is the stage, but the COUNTERS are the durable truth:
  // markItemFailed overwrites the stage, so a resumed item that had already
  // finished storage would otherwise re-run it and re-count every object.
  if (item.stage === 'storage_complete' || item.storageObjectsDeleted >= item.storageObjectsTotal) return;
  const objects = await listIncidentStorageObjects(item.incidentId!);
  for (const object of objects) {
    // Throws on any failure other than "already gone", which aborts this item
    // BEFORE the database transaction and leaves its evidence for the retry.
    const outcome = await deleteIncidentStorageObject(object.storagePath);
    await recordStorageObjectDeleted(item.id);
    // Only a real deletion counts. On a resume the objects are already gone,
    // and counting those would report deletions this run never performed.
    if (outcome === 'deleted') totals.storageDeleted += 1;
  }
  await markStorageComplete(item.id);
}

type ItemOutcome = 'completed' | 'failed' | 'skipped';

/**
 * Works one item through storage and then the database.
 *
 * The purgeability re-check comes FIRST and before anything destructive: the
 * claim has already committed and storage deletion is HTTP, so a hold raised
 * in that window would otherwise be discovered only when a bookkeeping UPDATE
 * was refused — after an attachment had been destroyed for an incident
 * somebody just decided to keep.
 *
 * Nothing here touches the item row before that check passes. Once an incident
 * is held, the schema refuses EVERY write about it, including `markItemFailed`
 * and `recordItemAttempt`; a skip that tries to record itself becomes an
 * exception that aborts the whole run.
 */
export async function processItem(
  item: RetentionItem, totals: Totals, options: { recordAttempt?: boolean } = {},
): Promise<ItemOutcome> {
  if (!item.incidentId) return 'skipped';
  const state = await getIncidentPurgeState(item.incidentId);
  if (state !== 'purgeable') {
    totals.skippedHold += 1;
    log.info('[fleet-retention] item no longer purgeable — left untouched for a later run', {
      itemId: item.id, state,
    }, MODULE);
    return 'skipped';
  }

  try {
    if (options.recordAttempt) await recordItemAttempt(item.id);
    await deleteItemStorage(item, totals);
    await purgeIncidentRecords({ itemId: item.id, incidentId: item.incidentId });
    totals.completed += 1;
    return 'completed';
  } catch (error) {
    // A hold that landed inside the residual window surfaces here as 23514.
    // Recording it is impossible (the same guard refuses that write), so the
    // item is left exactly as it is and picked up again once the hold lifts.
    if (isGuardRefusal(error)) {
      totals.skippedHold += 1;
      log.info('[fleet-retention] guard refused mid-item — a hold landed during the run', {
        itemId: item.id, code: errorCode(error),
      }, MODULE);
      return 'skipped';
    }
    totals.failed += 1;
    const code = errorCode(error);
    // Item ids and counts only: a retention log must not become a list of who
    // was investigated.
    log.error('[fleet-retention] item failed and was left for retry', {
      itemId: item.id, stage: item.stage, code,
    }, MODULE);
    try {
      await markItemFailed(item.id, code);
    } catch (recordError) {
      // Bookkeeping is never more important than the batch: a failure to
      // record a failure is logged and the run continues.
      log.error('[fleet-retention] could not record the item failure', {
        itemId: item.id, code: errorCode(recordError),
      }, MODULE);
    }
    return 'failed';
  }
}
