/**
 * Working ONE retention item through storage and then the database.
 *
 * Split out of `retentionService.ts` on size: that file owns the RUN — policy,
 * preflight, time budget, finalisation — and this owns what happens to a
 * single item, which is where every irreversible step lives.
 *
 * The item path is three phases, and the split is the safety property:
 *
 *   PLAN    — purgeability re-check, attempt counter, object listing, and the
 *             re-baseline of the storage accounting. Everything that can throw
 *             for a run-level or item-level reason happens HERE, before a
 *             single file is destroyed. Any failure is free: nothing is gone.
 *   EXECUTE — `storageDeletionRunner.deletePlannedObjects`, which takes the
 *             planned paths and nothing else. The only failure it can produce
 *             is "this object failed to delete". It cannot reach the database,
 *             because it does not import it.
 *   COMMIT  — one transaction: the storage accounting, every child row, the
 *             incident, and the item's completion. It either commits or rolls
 *             back whole.
 *
 * Three review rounds found three separate bugs where a statement between the
 * first delete and the commit threw for an unrelated reason — a wrong cast, a
 * config check, a counter guard — each destroying files and then removing no
 * rows. Those were instances of a class, and the phase split is what retires
 * the class rather than the instance.
 */
import { log } from '@/lib/logger';
import type { RetentionItem } from '../analytics/types';
import { purgeIncidentRecords } from './incidentPurge';
import { getIncidentPurgeState, listIncidentStorageObjects } from './retentionRepository';
import {
  markItemFailed, rebaselineStoragePlan, recordItemAttempt, recordStorageProgress,
} from './retentionRunRepository';
import { deletePlannedObjects } from './storageDeletionRunner';

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

interface ItemPurgePlan {
  /** Validated storage paths, in deletion order. Empty is legitimate. */
  storagePaths: string[];
}

/**
 * Everything that must be true before the first object is destroyed, done in
 * the order that makes each failure free.
 *
 * Returns null when the item must be skipped — the incident is held, no longer
 * terminal, or gone. A skip NEVER touches the item row: once an incident is
 * held, the schema refuses every write about it, including the one that would
 * record the failure, so a skip that tries to record itself becomes an
 * exception that aborts the whole run.
 */
async function planItemPurge(
  item: RetentionItem, options: { recordAttempt?: boolean },
): Promise<ItemPurgePlan | null> {
  const state = await getIncidentPurgeState(item.incidentId!);
  if (state !== 'purgeable') {
    log.info('[fleet-retention] item no longer purgeable — left untouched for a later run', {
      itemId: item.id, state,
    }, MODULE);
    return null;
  }
  if (options.recordAttempt) await recordItemAttempt(item.id);
  const objects = await listIncidentStorageObjects(item.incidentId!);
  const storagePaths = objects.map((object) => object.storagePath);
  // Adopts this attempt's object set and hands the guard its last cheap
  // refusal. After this line, a hold can still land — but it costs files, not
  // correctness, and that residual window is the one no database lock can
  // close around an HTTP call.
  await rebaselineStoragePlan(item.id, storagePaths.length);
  return { storagePaths };
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

  let plan: ItemPurgePlan | null;
  try {
    plan = await planItemPurge(item, options);
  } catch (error) {
    // Planning failed with nothing destroyed. A guard refusal here is a hold
    // that landed since the claim, which is a skip; anything else is a real
    // failure to record.
    return recordPlanningFailure(item, totals, error);
  }
  if (!plan) {
    totals.skippedHold += 1;
    return 'skipped';
  }

  let deleted = 0;
  try {
    // THE DESTRUCTIVE REGION. Nothing but per-object storage failures here.
    const counts = await deletePlannedObjects(plan.storagePaths);
    deleted = counts.deleted;
    totals.storageDeleted += counts.deleted;
    // One write, after the loop: the accounting the CHECK on
    // `database_complete` will be measured against.
    await recordStorageProgress(item.id, plan.storagePaths.length);
    await purgeIncidentRecords({ itemId: item.id, incidentId: item.incidentId });
    totals.completed += 1;
    return 'completed';
  } catch (error) {
    if (isGuardRefusal(error)) {
      totals.skippedHold += 1;
      log.info('[fleet-retention] guard refused after deletion began — a hold landed during the run', {
        itemId: item.id, code: errorCode(error), objectsDeleted: deleted,
      }, MODULE);
      return 'skipped';
    }
    return recordItemFailure(item, totals, error, deleted);
  }
}

/** A failure during planning: nothing was destroyed, so nothing is at risk. */
async function recordPlanningFailure(item: RetentionItem, totals: Totals, error: unknown): Promise<ItemOutcome> {
  if (isGuardRefusal(error)) {
    totals.skippedHold += 1;
    log.info('[fleet-retention] guard refused during planning — nothing was deleted', {
      itemId: item.id, code: errorCode(error),
    }, MODULE);
    return 'skipped';
  }
  return recordItemFailure(item, totals, error, 0);
}

/** Records a failure and leaves the item resumable. Never throws into the run. */
async function recordItemFailure(
  item: RetentionItem, totals: Totals, error: unknown, objectsDeleted: number,
): Promise<ItemOutcome> {
  totals.failed += 1;
  const code = errorCode(error);
  // Item ids and counts only: a retention log must not become a list of who
  // was investigated.
  log.error('[fleet-retention] item failed and was left for retry', {
    itemId: item.id, stage: item.stage, code, objectsDeleted,
  }, MODULE);
  try {
    await markItemFailed(item.id, code);
  } catch (recordError) {
    // Bookkeeping is never more important than the batch: a failure to record
    // a failure is logged and the run continues.
    log.error('[fleet-retention] could not record the item failure', {
      itemId: item.id, code: errorCode(recordError),
    }, MODULE);
  }
  return 'failed';
}
