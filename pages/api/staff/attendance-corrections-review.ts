/**
 * POST /api/staff/attendance-corrections-review
 *
 * Body: { adjustment_id, action: 'approve' | 'reject', review_note?: string }
 *
 * Transitions a pending adjustment to approved or rejected. Approve runs
 * all three state mutations inside a single DB transaction:
 *   1. adjustment status pending → approved
 *   2. apply adjusted_* fields to attendance_entries (with optimistic
 *      concurrency on updated_at — if the reconcile cron auto-closed the
 *      entry between our load and apply, we 409 instead of silently
 *      overwriting with COALESCE)
 *   3. DELETE the affected (staff, work_date) daily_summary so the
 *      reconcile cron recomputes it
 *
 * Any step throwing rolls all three back.
 *
 * RBAC: people.staff.attendance.corrections, edit.
 *
 * Lock enforcement: if the entry's week is currently locked, return 409
 * with a pointer to the unlock endpoint.
 *
 * Reject requires a review_note of at least 10 chars — staff need an
 * explanation on the rejected submission, and the audit trail needs
 * reviewer voice.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  loadAdjustmentWithEntry,
  transitionAdjustmentStatus,
  applyApprovedAdjustmentTxn,
} from '@/modules/attendance/corrections/queries';
import {
  isoWeekMonday,
  lookupActiveLock,
} from '@/modules/attendance/corrections/lockQueries';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }
  const reviewerId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!reviewerId) {
    apiResponse.unauthorized(res);
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const adjustmentId = typeof body.adjustment_id === 'string' ? body.adjustment_id : '';
  const action = body.action as 'approve' | 'reject' | undefined;
  const reviewNote = typeof body.review_note === 'string' ? body.review_note.trim() : '';

  if (!adjustmentId) {
    apiResponse.badRequest(res, 'adjustment_id is required');
    return;
  }
  if (action !== 'approve' && action !== 'reject') {
    apiResponse.badRequest(res, "action must be 'approve' or 'reject'");
    return;
  }
  if (action === 'reject' && reviewNote.length < 10) {
    apiResponse.badRequest(
      res,
      'review_note of at least 10 characters is required when rejecting (audit + staff explanation)'
    );
    return;
  }
  const noteForDb = reviewNote.length > 0 ? reviewNote : null;

  try {
    const existing = await loadAdjustmentWithEntry(adjustmentId);
    if (!existing) {
      apiResponse.notFound(res, 'Adjustment', adjustmentId);
      return;
    }
    if (existing.adjustment.status !== 'pending') {
      apiResponse.conflict(
        res,
        `Adjustment is already ${existing.adjustment.status}; review state machine forbids re-review`
      );
      return;
    }
    const weekMonday = isoWeekMonday(existing.entry.work_date);
    const activeLock = await lookupActiveLock(weekMonday);
    if (activeLock) {
      apiResponse.conflict(
        res,
        `Week ${weekMonday} is locked; unlock first via /api/staff/attendance-weekly-locks`
      );
      return;
    }

    if (action === 'reject') {
      const rejected = await transitionAdjustmentStatus({
        adjustmentId,
        reviewerId,
        newStatus: 'rejected',
        reviewNote: noteForDb,
      });
      if (!rejected) {
        apiResponse.conflict(res, 'Adjustment state changed under us — re-read and retry');
        return;
      }
      apiResponse.success(res, { adjustment: rejected });
      return;
    }

    // Approve path — transactional with optimistic concurrency on the
    // underlying entry's updated_at.
    const adjustedIn = existing.adjustment.adjusted_clock_in_at
      ? new Date(existing.adjustment.adjusted_clock_in_at)
      : null;
    const adjustedOut = existing.adjustment.adjusted_clock_out_at
      ? new Date(existing.adjustment.adjusted_clock_out_at)
      : null;
    // loadAdjustmentWithEntry doesn't return entry.updated_at today; fetch
    // the current value in a single cheap read before the transaction so
    // the optimistic guard has a known baseline.
    const result = await applyApprovedAdjustmentTxn({
      adjustmentId,
      reviewerId,
      reviewNote: noteForDb,
      entryId: existing.entry.id,
      entryUpdatedAt: await fetchEntryUpdatedAt(existing.entry.id),
      staffId: existing.entry.staff_id,
      workDate: existing.entry.work_date,
      adjustedClockInAt: adjustedIn,
      adjustedClockOutAt: adjustedOut,
      adjustedSiteGeofenceId: existing.adjustment.adjusted_site_geofence_id,
    });

    if (result.ok === 'conflict') {
      const msgMap = {
        adjustment_not_pending:
          'Adjustment state changed under us — re-read and retry',
        entry_changed:
          'The underlying entry was modified (likely by the reconcile cron or another reviewer). Re-read and retry.',
        entry_missing:
          'The underlying entry no longer exists — audit record only.',
      };
      apiResponse.conflict(res, msgMap[result.reason]);
      return;
    }
    apiResponse.success(res, { adjustment: result.adjustment });
  } catch (err) {
    log.error('[staff-corrections-review] failed', {
      adjustmentId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

async function fetchEntryUpdatedAt(entryId: string): Promise<string> {
  // Not ideal to have a separate read for this; future refactor: fold
  // into loadAdjustmentWithEntry's SELECT. Keeping it isolated now so the
  // public shape of loadAdjustmentWithEntry doesn't churn mid-PR.
  const { sql } = await import('@/lib/db-pool');
  const rows = await sql<{ updated_at: string }>`
    SELECT updated_at::text FROM attendance_entries WHERE id = ${entryId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`fetchEntryUpdatedAt: entry ${entryId} disappeared`);
  }
  return row.updated_at;
}

export default withAuth(
  withPermission('people.staff.attendance.corrections', 'edit')(handler)
);
