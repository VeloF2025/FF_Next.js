import { transaction, type TxnClient } from '@/lib/db-pool';
import {
  acquireAttendanceWeekLock,
  isoWeekMonday,
} from '@/modules/attendance/corrections/lockQueries';
import { serializeJsonPayload } from '@/services/attendance/policy/jsonPayloadValidation';

export interface SubmittedCorrection {
  adjustmentId: string;
  exceptionId: string;
  decisionEventId: string | null;
  exceptionStatus: 'awaiting_supervisor';
}

export type AttendanceCorrectionErrorCode =
  | 'not_found'
  | 'period_locked'
  | 'already_submitted'
  | 'invalid_timestamp'
  | 'invalid_reason';

export class AttendanceCorrectionError extends Error {
  constructor(public readonly code: AttendanceCorrectionErrorCode, message: string) {
    super(message);
    this.name = 'AttendanceCorrectionError';
  }
}

export async function submitMissingClockOutCorrection(args: {
  staffId: string;
  exceptionId: string;
  adjustedClockOutAt: Date;
  reason: string;
}): Promise<SubmittedCorrection> {
  const reason = args.reason.trim();
  if (!reason) {
    throw new AttendanceCorrectionError('invalid_reason', 'A correction reason is required');
  }
  if (Number.isNaN(args.adjustedClockOutAt.getTime())) {
    throw new AttendanceCorrectionError('invalid_timestamp', 'Claimed clock-out time is invalid');
  }
  return transaction((tx) => submitCorrectionTxn(tx, { ...args, reason }));
}

interface CorrectionRow extends Record<string, unknown> {
  exception_id: string;
  entry_id: string;
  staff_id: string;
  work_date: string;
  status: 'awaiting_worker' | 'awaiting_supervisor' | 'open' | 'resolved' | 'cancelled';
  adjustment_id: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  period_locked: boolean;
}

interface ExistingAdjustmentRow extends Record<string, unknown> {
  id: string;
  adjusted_clock_out_at: string;
  reason: string;
  status: 'pending';
}

interface OwnedExceptionRow extends Record<string, unknown> {
  work_date: string;
}

interface SummaryTransitionRow extends Record<string, unknown> {
  result_status: string;
}

interface IdRow extends Record<string, unknown> {
  id: string;
}

async function submitCorrectionTxn(
  tx: TxnClient,
  args: {
    staffId: string;
    exceptionId: string;
    adjustedClockOutAt: Date;
    reason: string;
  },
): Promise<SubmittedCorrection> {
  const owned = await loadOwnedExceptionWorkDate(tx, args.staffId, args.exceptionId);
  if (!owned) {
    throw new AttendanceCorrectionError('not_found', 'Attendance exception not found');
  }
  await acquireAttendanceWeekLock(tx, isoWeekMonday(owned.work_date));
  const exception = await loadOwnedException(tx, args.staffId, args.exceptionId);
  if (!exception) {
    throw new AttendanceCorrectionError('not_found', 'Attendance exception not found');
  }
  if (exception.status === 'awaiting_supervisor') {
    return loadIdenticalRetry(tx, exception, args);
  }
  if (exception.period_locked) {
    throw new AttendanceCorrectionError('period_locked', 'The attendance period is locked');
  }
  validateClaimedClockOut(exception, args.adjustedClockOutAt);
  if (exception.status !== 'awaiting_worker' || exception.adjustment_id) {
    throw new AttendanceCorrectionError('already_submitted', 'This correction is no longer awaiting worker input');
  }

  const adjustment = await tx.queryOne<IdRow>(`
    INSERT INTO attendance_adjustments (
      entry_id, requested_by, adjustment_kind, adjusted_clock_out_at, reason, status
    ) VALUES ($1::uuid, $2::uuid, 'forgot_clock_out', $3::timestamptz, $4, 'pending')
    RETURNING id`, [
    exception.entry_id, args.staffId, args.adjustedClockOutAt.toISOString(), args.reason,
  ]);
  if (!adjustment) throw new Error('Attendance correction insert returned no adjustment');

  const advanced = await tx.queryOne<IdRow>(`
    UPDATE attendance_day_exceptions
    SET adjustment_id = $3::uuid,
        status = 'awaiting_supervisor',
        updated_at = NOW()
    WHERE id = $1::uuid
      AND staff_id = $2::uuid
      AND status = 'awaiting_worker'
      AND adjustment_id IS NULL
    RETURNING id`, [args.exceptionId, args.staffId, adjustment.id]);
  if (!advanced) {
    throw new AttendanceCorrectionError('already_submitted', 'Correction state changed; reload and retry');
  }

  const summaries = await tx.query<SummaryTransitionRow>(`
    UPDATE attendance_daily_summaries
    SET result_status = 'awaiting_supervisor', computed_at = NOW()
    WHERE staff_id = $1::uuid
      AND work_date = $2::date
      AND result_status = 'awaiting_worker'
    RETURNING result_status`, [args.staffId, exception.work_date]);
  if (summaries.length !== 1 || summaries[0]?.result_status !== 'awaiting_supervisor') {
    throw new Error('Attendance daily summary did not advance to awaiting_supervisor');
  }

  const event = await insertDecisionEvent(tx, exception, adjustment.id, args);
  return {
    adjustmentId: adjustment.id,
    exceptionId: exception.exception_id,
    decisionEventId: event.id,
    exceptionStatus: 'awaiting_supervisor',
  };
}

async function loadOwnedExceptionWorkDate(
  tx: TxnClient,
  staffId: string,
  exceptionId: string,
): Promise<OwnedExceptionRow | null> {
  return tx.queryOne<OwnedExceptionRow>(`
    SELECT TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date
    FROM attendance_day_exceptions de
    JOIN attendance_entries e ON e.id = de.entry_id AND e.staff_id = de.staff_id
    WHERE de.id = $2::uuid
      AND de.staff_id = $1::uuid
      AND de.kind = 'missing_clock_out'`, [staffId, exceptionId]);
}

async function loadOwnedException(
  tx: TxnClient,
  staffId: string,
  exceptionId: string,
): Promise<CorrectionRow | null> {
  return tx.queryOne<CorrectionRow>(`
    SELECT de.id AS exception_id, de.entry_id, de.staff_id,
           TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date,
           de.kind, de.status, de.adjustment_id,
           e.clock_in_at::text, e.clock_out_at::text,
           EXISTS (
             SELECT 1 FROM attendance_weekly_locks wl
             WHERE wl.week_start_date = date_trunc('week', de.work_date)::date
               AND wl.unlocked_at IS NULL
           ) AS period_locked
    FROM attendance_day_exceptions de
    JOIN attendance_entries e
      ON e.id = de.entry_id
     AND e.staff_id = de.staff_id
    WHERE de.id = $2::uuid
      AND de.staff_id = $1::uuid
      AND de.kind = 'missing_clock_out'
    FOR UPDATE OF de`, [staffId, exceptionId]);
}

async function loadIdenticalRetry(
  tx: TxnClient,
  exception: CorrectionRow,
  args: { adjustedClockOutAt: Date; reason: string },
): Promise<SubmittedCorrection> {
  if (!exception.adjustment_id) {
    throw new AttendanceCorrectionError('already_submitted', 'Correction state is inconsistent');
  }
  const existing = await tx.queryOne<ExistingAdjustmentRow>(`
    SELECT id, adjusted_clock_out_at::text, reason, status
    FROM attendance_adjustments
    WHERE id = $1::uuid
      AND entry_id = $2::uuid
      AND requested_by = $3::uuid
      AND adjustment_kind = 'forgot_clock_out'
      AND status = 'pending'
    FOR SHARE`, [exception.adjustment_id, exception.entry_id, exception.staff_id]);
  const sameTime = existing &&
    new Date(existing.adjusted_clock_out_at).getTime() === args.adjustedClockOutAt.getTime();
  if (!existing || !sameTime || existing.reason.trim() !== args.reason) {
    throw new AttendanceCorrectionError('already_submitted', 'A different correction is already pending');
  }
  return {
    adjustmentId: existing.id,
    exceptionId: exception.exception_id,
    decisionEventId: null,
    exceptionStatus: 'awaiting_supervisor',
  };
}

function validateClaimedClockOut(exception: CorrectionRow, claimed: Date): void {
  const clockIn = new Date(exception.clock_in_at);
  const future = claimed.getTime() > Date.now();
  const wrongDay = sastDate(claimed) !== exception.work_date;
  if (exception.clock_out_at || claimed.getTime() <= clockIn.getTime() || future || wrongDay) {
    throw new AttendanceCorrectionError(
      'invalid_timestamp',
      'Claimed clock-out must be after clock-in, on the work date, and not in the future',
    );
  }
}

function sastDate(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function insertDecisionEvent(
  tx: TxnClient,
  exception: CorrectionRow,
  adjustmentId: string,
  args: { staffId: string; adjustedClockOutAt: Date; reason: string },
): Promise<IdRow> {
  const beforeValue = serializeJsonPayload({ status: 'awaiting_worker', adjustmentId: null });
  const afterValue = serializeJsonPayload({
    status: 'awaiting_supervisor', adjustmentId,
    adjustedClockOutAt: args.adjustedClockOutAt.toISOString(),
  });
  const event = await tx.queryOne<IdRow>(`
    INSERT INTO attendance_decision_events (
      entity_type, entity_key, action, actor_staff_id, reason, before_value, after_value
    ) VALUES (
      'day_exception', $1, 'worker_correction_submitted', $2::uuid, $3, $4::jsonb, $5::jsonb
    )
    RETURNING id`, [exception.exception_id, args.staffId, args.reason, beforeValue, afterValue]);
  if (!event) throw new Error('Attendance correction decision event returned no row');
  return event;
}
