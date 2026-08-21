/**
 * Dry-run and failure-safe orchestration of the retention pipeline.
 *
 * Ordering is the safety property. For each item: storage objects first, then
 * the database transaction, then completion. A storage failure therefore
 * leaves BOTH the file and the database evidence in place for a retry; the one
 * outcome this must never produce is a deleted file with no record that it
 * existed. On retry the storage stage runs again and a missing object reports
 * `already_absent`, so a half-finished item can always be finished.
 *
 * A dry run creates a run row and reports counts. It claims nothing, deletes
 * nothing, and calls storage not at all — and the run row's
 * `..._dry_run_deletes_nothing` CHECK enforces that independently of this code.
 *
 * Live deletion additionally requires `live_retention_enabled` in the effective
 * settings. Until an operator turns that on, the scheduled job can only ever
 * report.
 */
import { log } from '@/lib/logger';
import { transaction, type TxnClient } from '@/lib/db-pool';
import { getEffectiveAnalyticsRetentionSettings } from '../analytics/settingsRepository';
import type { RetentionItem, RetentionPolicy, RunStatus } from '../analytics/types';
import { purgeIncidentRecords } from './incidentPurge';
import {
  claimIncident, countCandidatesHeld, finalizeRetentionRun, getIncidentPurgeState,
  hasCompleteAggregateCoverage, insertRetentionRun, listIncidentStorageObjects, listPurgeCandidates,
  listResumableItems, markItemFailed, markStorageComplete, recordItemAttempt,
  recordStorageObjectDeleted,
} from './retentionRepository';
import { notifyRetentionHealth } from './retentionNotifications';
import { deleteIncidentStorageObject } from './storageDeletion';

const MODULE = 'FleetRetentionService';

export class LiveRetentionDisabledError extends Error {
  constructor(message: string) { super(message); this.name = 'LiveRetentionDisabledError'; }
}

export interface RetentionRunRequest {
  dryRun: boolean;
  requestedAt: string;
  triggerSource?: 'cron' | 'manual';
}

export interface RetentionResult {
  runId: string;
  dryRun: boolean;
  status: RunStatus;
  cutoffWorkDate: string;
  policyMonths: number;
  itemsConsidered: number;
  itemsClaimed: number;
  itemsCompleted: number;
  itemsFailed: number;
  itemsSkippedHold: number;
  itemsSkippedCoverage: number;
  storageObjectsDeleted: number;
  /** Dry run only: objects that WOULD be deleted. Never a byte total — the evidence table records no size. */
  storageObjectsPending: number;
}

/** The SAST calendar date `retentionMonths` before the run instant. Everything strictly older than it is out of policy. */
export function resolveCutoffWorkDate(requestedAt: string, retentionMonths: number): string {
  const sast = new Date(new Date(requestedAt).getTime() + 2 * 60 * 60 * 1000);
  const cutoff = new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth() - retentionMonths, sast.getUTCDate()));
  return cutoff.toISOString().slice(0, 10);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return error instanceof Error ? error.name : 'unknown_error';
}

/**
 * `trg_fleet_retention_item_guard` refuses any write about an incident that is
 * held or non-terminal, with 23514. That is an EXPECTED outcome of a hold
 * landing mid-run, not a crash — and critically, it also refuses the write
 * that would record the failure, so a refusal must never be routed into the
 * failure path.
 */
function isGuardRefusal(error: unknown): boolean {
  return errorCode(error) === '23514';
}

/** A claim refused by the guard (23514) or already taken (23505) is expected too. */
function isExpectedClaimRefusal(error: unknown): boolean {
  const code = errorCode(error);
  return code === '23514' || code === '23505';
}

interface Totals {
  considered: number; claimed: number; completed: number; failed: number;
  skippedHold: number; skippedCoverage: number; storageDeleted: number; storagePending: number;
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
async function processItem(
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

async function claimAndProcessCandidates(
  runId: string, policy: RetentionPolicy, cutoffWorkDate: string, totals: Totals,
): Promise<void> {
  const candidates = await listPurgeCandidates({ cutoffWorkDate, limit: policy.retentionBatchSize });
  totals.considered += candidates.length;
  for (const candidate of candidates) {
    if (!await hasCompleteAggregateCoverage(candidate.monthStart, policy.metricVersion)) {
      totals.skippedCoverage += 1;
      continue;
    }
    const objects = await listIncidentStorageObjects(candidate.incidentId);
    let item: RetentionItem;
    try {
      item = await transaction(async (txn: TxnClient) => claimIncident(txn, {
        runId, incidentId: candidate.incidentId, storageObjectsTotal: objects.length,
      }));
    } catch (error) {
      if (isExpectedClaimRefusal(error)) {
        // A hold raised (or a claim taken) between selection and claim wins.
        totals.skippedHold += 1;
        continue;
      }
      throw error;
    }
    totals.claimed += 1;
    await processItem(item, totals);
  }
}

async function runDryRun(policy: RetentionPolicy, cutoffWorkDate: string, totals: Totals): Promise<void> {
  const candidates = await listPurgeCandidates({ cutoffWorkDate, limit: policy.retentionBatchSize });
  totals.considered = candidates.length;
  totals.skippedHold = await countCandidatesHeld({ cutoffWorkDate });
  for (const candidate of candidates) {
    if (!await hasCompleteAggregateCoverage(candidate.monthStart, policy.metricVersion)) {
      totals.skippedCoverage += 1;
      continue;
    }
    totals.storagePending += (await listIncidentStorageObjects(candidate.incidentId)).length;
  }
}

export async function runOperationalRetention(request: RetentionRunRequest): Promise<RetentionResult> {
  const policy = await getEffectiveAnalyticsRetentionSettings(request.requestedAt);
  if (!request.dryRun && !policy.liveRetentionEnabled) {
    throw new LiveRetentionDisabledError('Live retention is disabled in the effective Fleet analytics settings');
  }
  // The effective policy is the one in force at the run instant, so a
  // shortened policy can never delete anything before its own effective time.
  const cutoffWorkDate = resolveCutoffWorkDate(request.requestedAt, policy.retentionMonths);
  const runId = await insertRetentionRun({
    dryRun: request.dryRun, cutoffWorkDate, policyMonths: policy.retentionMonths,
    triggerSource: request.triggerSource ?? 'cron',
  });
  const totals: Totals = {
    considered: 0, claimed: 0, completed: 0, failed: 0,
    skippedHold: 0, skippedCoverage: 0, storageDeleted: 0, storagePending: 0,
  };

  let status: RunStatus = 'succeeded';
  try {
    if (request.dryRun) {
      await runDryRun(policy, cutoffWorkDate, totals);
    } else {
      for (const stale of await listResumableItems(policy.retentionBatchSize)) {
        // The attempt counter is incremented INSIDE processItem, after the
        // purgeability check — it is an UPDATE the guard refuses for a held
        // item, and one held item used to abort the run before any candidate
        // was reached.
        const outcome = await processItem(stale, totals, { recordAttempt: true });
        if (outcome !== 'skipped') totals.claimed += 1;
      }
      await claimAndProcessCandidates(runId, policy, cutoffWorkDate, totals);
    }
    if (totals.failed > 0) status = 'partial';
  } catch (error) {
    // A fatal error still finalises the run: a run row stuck in `running`
    // would read as "in flight" forever and suppress the staleness alert.
    await finalizeRetentionRun(runId, {
      status: 'failed', itemsConsidered: totals.considered, itemsClaimed: totals.claimed,
      itemsCompleted: totals.completed, itemsFailed: totals.failed, itemsSkippedHold: totals.skippedHold,
      itemsSkippedCoverage: totals.skippedCoverage, storageObjectsDeleted: totals.storageDeleted,
      errorCode: errorCode(error),
    });
    throw error;
  }

  await finalizeRetentionRun(runId, {
    status, itemsConsidered: totals.considered, itemsClaimed: totals.claimed,
    itemsCompleted: totals.completed, itemsFailed: totals.failed, itemsSkippedHold: totals.skippedHold,
    itemsSkippedCoverage: totals.skippedCoverage, storageObjectsDeleted: totals.storageDeleted,
    errorCode: null,
  });

  // Strictly after finalisation, and never allowed to fail the run.
  try {
    await notifyRetentionHealth({ at: request.requestedAt });
  } catch (error) {
    log.error('[fleet-retention] health notification failed after the run', {
      runId, error: error instanceof Error ? error.message : String(error),
    }, MODULE);
  }

  return {
    runId, dryRun: request.dryRun, status, cutoffWorkDate, policyMonths: policy.retentionMonths,
    itemsConsidered: totals.considered, itemsClaimed: totals.claimed, itemsCompleted: totals.completed,
    itemsFailed: totals.failed, itemsSkippedHold: totals.skippedHold,
    itemsSkippedCoverage: totals.skippedCoverage, storageObjectsDeleted: totals.storageDeleted,
    storageObjectsPending: totals.storagePending,
  };
}
