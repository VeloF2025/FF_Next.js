import type { ExportTransitionUpdates, VelocityReviewExport } from './exportRepository';
import { HighLevelRequestError } from './ghlClient';
import { nextRetryAt } from './retry';
import { ENROLLED_TAG } from './types';

const CLEANUP_LEASE_MS = 60_000;

export function cleanupLeaseUntil(now: Date): Date {
  return new Date(now.getTime() + CLEANUP_LEASE_MS);
}

interface CleanupDependencies {
  now(): Date;
  ghl: { removeTags(contactId: string, tags: readonly string[]): Promise<void> };
  exports: {
    transitionExportState(id: string, expected: 'ack_cleanup_pending', next: 'ack_cleanup_pending' | 'completed',
      updates?: ExportTransitionUpdates): Promise<VelocityReviewExport | null>;
  };
}

export interface AcknowledgementCleanupResult {
  exportId: string;
  state: VelocityReviewExport['state'];
  errorCode: string | null;
  nextAttemptAt: Date | null;
  workflowAcknowledged: true;
}

function result(row: VelocityReviewExport): AcknowledgementCleanupResult {
  return { exportId: row.id, state: row.state, errorCode: row.errorCode,
    nextAttemptAt: row.nextAttemptAt, workflowAcknowledged: true };
}

async function move(row: VelocityReviewExport, deps: CleanupDependencies,
  next: 'ack_cleanup_pending' | 'completed', updates: ExportTransitionUpdates): Promise<VelocityReviewExport> {
  const changed = await deps.exports.transitionExportState(row.id, 'ack_cleanup_pending', next, updates);
  if (!changed) throw new Error('Velocity review cleanup state changed concurrently');
  return changed;
}

export async function processAcknowledgementCleanup(
  row: VelocityReviewExport,
  deps: CleanupDependencies,
): Promise<AcknowledgementCleanupResult> {
  if (!row.ghlContactId) {
    return result(await move(row, deps, 'ack_cleanup_pending', {
      errorCode: 'ack_cleanup_missing_contact', nextAttemptAt: null,
    }));
  }
  try {
    await deps.ghl.removeTags(row.ghlContactId, [ENROLLED_TAG]);
  } catch (error) {
    if (error instanceof HighLevelRequestError && error.retryable && !error.ambiguousMutation) {
      const retryAt = nextRetryAt(deps.now(), row.attemptCount, error.retryAfterSeconds);
      return result(await move(row, deps, 'ack_cleanup_pending', {
        errorCode: retryAt ? 'ack_cleanup_retryable' : 'ack_cleanup_retry_exhausted', nextAttemptAt: retryAt,
      }));
    }
    return result(await move(row, deps, 'ack_cleanup_pending', {
      errorCode: error instanceof HighLevelRequestError && error.ambiguousMutation
        ? 'ack_cleanup_ambiguous' : 'ack_cleanup_permanent',
      nextAttemptAt: null,
    }));
  }
  return result(await move(row, deps, 'completed', {
    completedAt: deps.now(), errorCode: null, nextAttemptAt: null,
  }));
}
