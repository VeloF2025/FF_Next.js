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
  claimIncident, countCandidatesHeld, finalizeRetentionRun, hasCompleteAggregateCoverage,
  insertRetentionRun, listIncidentStorageObjects, listPurgeCandidates, listResumableItems,
  markItemFailed, markStorageComplete, recordItemAttempt, recordStorageObjectDeleted,
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

/** A claim refused by `trg_fleet_retention_item_guard` (23514) or already taken (23505) is an expected outcome, not a crash. */
function isExpectedClaimRefusal(error: unknown): boolean {
  const code = errorCode(error);
  return code === '23514' || code === '23505';
}

interface Totals {
  considered: number; claimed: number; completed: number; failed: number;
  skippedHold: number; skippedCoverage: number; storageDeleted: number; storagePending: number;
}

async function deleteItemStorage(item: RetentionItem, totals: Totals): Promise<void> {
  if (item.stage === 'storage_complete') return;
  const objects = await listIncidentStorageObjects(item.incidentId!);
  for (const object of objects) {
    // Throws on any failure other than "already gone", which aborts this item
    // BEFORE the database transaction and leaves its evidence for the retry.
    await deleteIncidentStorageObject(object.storagePath);
    await recordStorageObjectDeleted(item.id);
    totals.storageDeleted += 1;
  }
  await markStorageComplete(item.id);
}

async function processItem(item: RetentionItem, totals: Totals): Promise<void> {
  if (!item.incidentId) return;
  try {
    await deleteItemStorage(item, totals);
    await purgeIncidentRecords({ itemId: item.id, incidentId: item.incidentId });
    totals.completed += 1;
  } catch (error) {
    totals.failed += 1;
    const code = errorCode(error);
    await markItemFailed(item.id, code);
    // Item ids and counts only: a retention log must not become a list of who
    // was investigated.
    log.error('[fleet-retention] item failed and was left for retry', {
      itemId: item.id, stage: item.stage, code,
    }, MODULE);
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
        await recordItemAttempt(stale.id);
        totals.claimed += 1;
        await processItem(stale, totals);
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
