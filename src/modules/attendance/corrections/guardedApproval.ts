/**
 * Applying an approved attendance adjustment, under the payroll-week lock.
 *
 * NO SEGREGATION OF DUTIES — knowingly accepted, 2026-08-02.
 * `reviewerId` and `requestedBy` are carried separately here but never compared, and
 * `createAndApproveAdjustmentTxn` mints an already-approved adjustment in one transaction.
 * So an approver who is also the subject can approve their own correction, on data that
 * feeds pay, with no second pair of eyes.
 *
 * A field worker cannot: they hold only an `ff_my_session` portal session, while approval
 * needs a main-app session plus `people.staff.attendance.corrections:edit`. The exposure is
 * an admin or manager who is also a staff member approving their own row.
 *
 * Accepted at Velocity's current size. Note the check is not merely omitted — it is not
 * cheaply available: `reviewerId` is a `users.id` while the subject is a `staff.id`, and
 * no user→staff mapping exists on this path. Adding one is the prerequisite for enforcing
 * requester ≠ approver, should that become required (an auditor asking who approved what,
 * or the first disputed correction, are the likely triggers).
 */
import { transaction, type TxnClient } from '@/lib/db-pool';
import {
  assertDailyProjectionUnlocked,
  guardProjectionDay,
} from '@/services/attendance/policy/projectionLockGuard';
import type { AdjustmentKind, AdjustmentRow } from './types';

type ConflictReason = 'adjustment_not_pending' | 'entry_changed' | 'entry_missing';
export type ApproveResult =
  { ok: true; adjustment: AdjustmentRow } | { ok: 'conflict'; reason: ConflictReason };

class ApprovalConflict extends Error {
  constructor(readonly reason: ConflictReason) {
    super(reason);
  }
}

interface ApprovalEvidenceArgs {
  reviewerId: string;
  reviewNote: string | null;
  entryId: string;
  entryUpdatedAt: string;
  staffId: string;
  workDate: string;
  adjustedClockInAt: Date | null;
  adjustedClockOutAt: Date | null;
  adjustedSiteGeofenceId: string | null;
}

export interface ApprovedAdjustmentArgs extends ApprovalEvidenceArgs {
  adjustmentId: string;
}

export interface CreateAndApproveAdjustmentArgs extends ApprovalEvidenceArgs {
  requestedBy: string;
  adjustmentKind: AdjustmentKind;
  reason: string;
}

export async function applyApprovedAdjustmentTxn(
  args: ApprovedAdjustmentArgs
): Promise<ApproveResult> {
  return runGuardedApproval(args, null);
}

export async function createAndApproveAdjustmentTxn(
  args: CreateAndApproveAdjustmentArgs
): Promise<ApproveResult> {
  return runGuardedApproval(args, args);
}

async function runGuardedApproval(
  args: ApprovalEvidenceArgs & { adjustmentId?: string },
  create: CreateAndApproveAdjustmentArgs | null
): Promise<ApproveResult> {
  try {
    return await transaction(async (txn) => {
      await guardApprovalDay(txn, args.staffId, args.workDate);
      const adjustmentId = create ? await insertPendingAdjustment(txn, create) : args.adjustmentId;
      if (!adjustmentId) throw new Error('Guarded approval requires an adjustment ID');
      const adjustment = await approveWithinTransaction(txn, adjustmentId, args);
      return { ok: true, adjustment };
    });
  } catch (error) {
    if (error instanceof ApprovalConflict) return { ok: 'conflict', reason: error.reason };
    throw error;
  }
}

async function guardApprovalDay(txn: TxnClient, staffId: string, workDate: string): Promise<void> {
  await guardProjectionDay(txn, staffId, workDate);
  const daily = await txn.queryOne<{ result_status: string }>(
    `
    SELECT result_status FROM attendance_daily_summaries
    WHERE staff_id = $1::uuid AND work_date = $2::date
    FOR UPDATE`,
    [staffId, workDate]
  );
  assertDailyProjectionUnlocked(daily?.result_status);
}

async function insertPendingAdjustment(
  txn: TxnClient,
  args: CreateAndApproveAdjustmentArgs
): Promise<string> {
  const rows = await txn.query<{ id: string }>(
    `
    INSERT INTO attendance_adjustments (
      entry_id, requested_by, adjustment_kind,
      adjusted_clock_in_at, adjusted_clock_out_at, adjusted_site_geofence_id,
      reason, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
    RETURNING id`,
    [
      args.entryId,
      args.requestedBy,
      args.adjustmentKind,
      args.adjustedClockInAt?.toISOString() ?? null,
      args.adjustedClockOutAt?.toISOString() ?? null,
      args.adjustedSiteGeofenceId,
      args.reason,
    ]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('insertPendingAdjustment returned no row');
  return id;
}

async function approveWithinTransaction(
  txn: TxnClient,
  adjustmentId: string,
  args: ApprovalEvidenceArgs
): Promise<AdjustmentRow> {
  const transitioned = await txn.query<AdjustmentRow>(
    `
    UPDATE attendance_adjustments
    SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
        review_note = $2, updated_at = NOW()
    WHERE id = $3 AND status = 'pending'
    RETURNING *`,
    [args.reviewerId, args.reviewNote, adjustmentId]
  );
  if (transitioned.length === 0) throw new ApprovalConflict('adjustment_not_pending');

  const evidence = await txn.query<{ id: string }>(
    `
    SELECT id FROM attendance_entries
    WHERE id = $1 AND updated_at = $2::timestamptz
    FOR SHARE`,
    [args.entryId, args.entryUpdatedAt]
  );
  if (evidence.length === 0) {
    const exists = await txn.query<{ id: string }>(
      'SELECT id FROM attendance_entries WHERE id = $1 LIMIT 1',
      [args.entryId]
    );
    throw new ApprovalConflict(exists.length === 0 ? 'entry_missing' : 'entry_changed');
  }

  await txn.query(`
    UPDATE attendance_daily_summaries
    SET result_status = 'provisional', approved_regular_hrs = NULL,
        approved_overtime_hrs = NULL, approved_sunday_hrs = NULL,
        approved_holiday_hrs = NULL, approved_at = NULL, approved_by = NULL,
        computed_at = NOW()
    WHERE staff_id = $1::uuid AND work_date = $2::date
      AND result_status <> 'locked'`, [args.staffId, args.workDate]);

  const adjustment = transitioned[0];
  if (!adjustment) throw new Error('Guarded approval transition returned no row');
  return adjustment;
}
