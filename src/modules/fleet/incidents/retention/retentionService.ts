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
import { preflightPurgeStatements } from './incidentPurge';
import {
  countCandidatesHeld, hasCompleteAggregateCoverage, listIncidentStorageObjects, listPurgeCandidates,
} from './retentionRepository';
import {
  claimIncident, finalizeRetentionRun, insertRetentionRun, listResumableItems,
} from './retentionRunRepository';
import {
  errorCode, isExpectedClaimRefusal, processItem, type Totals,
} from './retentionItemProcessor';
import { notifyRetentionHealth } from './retentionNotifications';
import { assertRetentionIdentityConfigured } from './retentionDb';

const MODULE = 'FleetRetentionService';
/**
 * How long a run may keep claiming NEW work.
 *
 * `storageDeletion`'s per-request timeout bounds one HTTP call; it says nothing
 * about a run of 100 items with several attachments each. A run holds the
 * `fleet-operational-retention` advisory lock for its whole duration, so an
 * unbounded run blocks every later tick as well as this one. Work already
 * claimed is always finished — stopping mid-item is what strands evidence.
 */
const RUN_BUDGET_MS = 10 * 60 * 1000;

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
  /** True when the run stopped claiming new work to stay inside its time budget. Remaining candidates wait for the next run. */
  stoppedForBudget: boolean;
}

/** The SAST calendar date `retentionMonths` before the run instant. Everything strictly older than it is out of policy. */
export function resolveCutoffWorkDate(requestedAt: string, retentionMonths: number): string {
  const sast = new Date(new Date(requestedAt).getTime() + 2 * 60 * 60 * 1000);
  const cutoff = new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth() - retentionMonths, sast.getUTCDate()));
  return cutoff.toISOString().slice(0, 10);
}

async function claimAndProcessCandidates(
  runId: string, policy: RetentionPolicy, cutoffWorkDate: string, totals: Totals, deadline: number,
): Promise<void> {
  const candidates = await listPurgeCandidates({ cutoffWorkDate, limit: policy.retentionBatchSize });
  totals.considered += candidates.length;
  for (const candidate of candidates) {
    // Checked before CLAIMING, never mid-item: an item already claimed is
    // carried to completion so no evidence is left half-deleted.
    if (Date.now() >= deadline) {
      totals.stoppedForBudget = true;
      log.warn('[fleet-retention] run budget spent — remaining candidates left for the next run', {
        claimed: totals.claimed, considered: totals.considered,
      }, MODULE);
      return;
    }
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
  // Before the run row, before any item: a configuration fault must not be
  // discovered after the first attachment has been destroyed.
  if (!request.dryRun) assertRetentionIdentityConfigured();
  const cutoffWorkDate = resolveCutoffWorkDate(request.requestedAt, policy.retentionMonths);
  const runId = await insertRetentionRun({
    dryRun: request.dryRun, cutoffWorkDate, policyMonths: policy.retentionMonths,
    triggerSource: request.triggerSource ?? 'cron',
  });
  const totals: Totals = {
    considered: 0, claimed: 0, completed: 0, failed: 0,
    skippedHold: 0, skippedCoverage: 0, storageDeleted: 0, storagePending: 0, stoppedForBudget: false,
  };
  const deadline = Date.now() + RUN_BUDGET_MS;

  let status: RunStatus = 'succeeded';
  try {
    if (request.dryRun) {
      // A dry run deletes nothing, so it neither needs nor checks delete
      // privileges — it must still be able to report on a database the live
      // run could not touch.
      await runDryRun(policy, cutoffWorkDate, totals);
    } else {
      // Deterministic, run-wide faults (privileges, casts, renamed columns)
      // are caught here rather than one destroyed attachment at a time.
      await preflightPurgeStatements();
      for (const stale of await listResumableItems(policy.retentionBatchSize)) {
        if (Date.now() >= deadline) { totals.stoppedForBudget = true; break; }
        // The attempt counter is incremented INSIDE processItem, after the
        // purgeability check — it is an UPDATE the guard refuses for a held
        // item, and one held item used to abort the run before any candidate
        // was reached.
        const outcome = await processItem(stale, totals, { recordAttempt: true });
        if (outcome !== 'skipped') totals.claimed += 1;
      }
      await claimAndProcessCandidates(runId, policy, cutoffWorkDate, totals, deadline);
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
    storageObjectsPending: totals.storagePending, stoppedForBudget: totals.stoppedForBudget,
  };
}
