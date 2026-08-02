import { transaction, type TxnClient } from '@/lib/db-pool';
import { userHasPermission } from '@/lib/permissions';
import {
  acquireAttendanceWeekLock,
  isoWeekMonday,
} from '@/modules/attendance/corrections/lockQueries';
import { resolveScope } from '@/services/attendance/search/scope';
import { serializeJsonPayload } from '@/services/attendance/policy/jsonPayloadValidation';

import type {
  ApprovedHours, AttendanceClassification, DayExceptionDecisionInput,
  DayExceptionDecisionResult, DayExceptionKind, DayExceptionStatus,
} from './types';
import {
  DayExceptionWorkflowError, classificationApprovedHours,
  assertDecisionActionPermitted, validateApprovedHours, validateDecisionInput,
  type DayExceptionWorkflowErrorCode,
} from './dayExceptionDecisionValidation';
export { DayExceptionWorkflowError };
interface PreliminaryRow extends Record<string, unknown> { staff_id: string; work_date: string }
interface RoleRow extends Record<string, unknown> { role: string }
interface DecisionStateRow extends Record<string, unknown> {
  exception_id: string;
  staff_id: string;
  work_date: string;
  entry_id: string | null;
  adjustment_id: string | null;
  kind: DayExceptionKind;
  status: DayExceptionStatus;
  result_version: string | number;
  summary_result_version: string | number;
  period_locked: boolean;
  scheduled_paid_hrs: string | number;
  result_status: string;
  approved_regular_hrs: string | number | null;
  approved_overtime_hrs: string | number | null;
  approved_sunday_hrs: string | number | null;
  approved_holiday_hrs: string | number | null;
  leave_hrs: string | number;
  unpaid_hrs: string | number;
  attendance_classification: AttendanceClassification | null;
  adjustment_status: string | null;
}
interface IdRow extends Record<string, unknown> { id: string }
interface VersionRow extends Record<string, unknown> { result_version: string | number }
interface PersistedRow extends Record<string, unknown> {
  exception_id: string;
  exception_status: DayExceptionStatus;
  exception_result_version: string | number;
  exception_classification: AttendanceClassification | null;
  resolution_reason: string | null;
  staff_id: string;
  work_date: string;
  result_status: DayExceptionDecisionResult['dailyResult']['status'];
  summary_result_version: string | number;
  approved_regular_hrs: string | number | null;
  approved_overtime_hrs: string | number | null;
  approved_sunday_hrs: string | number | null;
  approved_holiday_hrs: string | number | null;
  leave_hrs: string | number;
  unpaid_hrs: string | number;
  attendance_classification: AttendanceClassification | null;
}

function invalid(code: DayExceptionWorkflowErrorCode, message: string): never {
  throw new DayExceptionWorkflowError(code, message);
}

export async function decideDayException(input: DayExceptionDecisionInput): Promise<DayExceptionDecisionResult> {
  const reason = validateDecisionInput(input);
  return transaction((tx) => decideTxn(tx, { ...input, reason }));
}

async function decideTxn(
  tx: TxnClient,
  input: DayExceptionDecisionInput & { reason: string },
): Promise<DayExceptionDecisionResult> {
  const preliminary = await tx.queryOne<PreliminaryRow>(`
    SELECT staff_id, TO_CHAR(work_date, 'YYYY-MM-DD') AS work_date
    FROM attendance_day_exceptions WHERE id = $1::uuid`, [input.exceptionId]);
  if (!preliminary) invalid('not_found', 'Attendance exception not found');
  await acquireAttendanceWeekLock(tx, isoWeekMonday(preliminary.work_date));

  const currentRole = await tx.queryOne<RoleRow>(`
    SELECT role FROM users WHERE id = $1::uuid AND is_active = true`, [input.actor.id]);
  if (!currentRole) invalid('forbidden', 'Decision permission denied');
  const actor = { ...input.actor, role: currentRole.role };
  const scope = await resolveScope(actor);
  if (scope.allowedStaffIds !== null && !scope.allowedStaffIds.includes(preliminary.staff_id)) {
    invalid('not_found', 'Attendance exception not found');
  }
  if (!await userHasPermission(actor.id, 'people.staff.attendance.corrections', 'edit')) {
    invalid('forbidden', 'Decision permission denied');
  }

  const state = await loadDecisionState(tx, input.exceptionId);
  if (!state || state.staff_id !== preliminary.staff_id) invalid('not_found', 'Attendance exception not found');
  if (!['open', 'awaiting_worker', 'awaiting_supervisor'].includes(state.status)) {
    invalid('already_decided', 'Attendance exception was already decided');
  }
  const exceptionVersion = Number(state.result_version);
  const summaryVersion = Number(state.summary_result_version);
  if (exceptionVersion !== input.expectedResultVersion || summaryVersion !== input.expectedResultVersion) {
    invalid('result_stale', 'Attendance result changed; reload before deciding');
  }
  if (state.period_locked) invalid('period_locked', 'The payroll week is locked');
  assertDecisionActionPermitted({
    kind: state.kind,
    status: state.status,
    adjustmentId: state.adjustment_id,
    adjustmentStatus: state.adjustment_status,
  }, input.action);

  const scheduled = Number(state.scheduled_paid_hrs);
  if (!Number.isFinite(scheduled) || scheduled < 0 || scheduled > 24) throw new Error('Invalid scheduled attendance hours');
  const hours = input.action === 'return' ? null : input.approvedHours ??
    classificationApprovedHours(input.classification!, scheduled);
  const classification = input.action === 'classify' ? input.classification! : null;
  if (hours) validateApprovedHours(hours, classification);
  const nextVersion = await writeDailyResult(tx, state, input, hours, classification);
  await writeAdjustment(tx, state, input);
  await writeException(tx, state, input, nextVersion, classification);
  await advanceSiblingVersions(tx, state, nextVersion);
  const eventId = await writeDecisionEvent(tx, state, input, nextVersion, hours, classification);
  return readPersistedDecision(tx, input.exceptionId, eventId);
}

async function loadDecisionState(tx: TxnClient, exceptionId: string): Promise<DecisionStateRow | null> {
  return tx.queryOne<DecisionStateRow>(`
    SELECT de.id AS exception_id, de.staff_id, TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date,
           de.entry_id, de.adjustment_id, de.kind, de.status, de.result_version,
           ds.result_version AS summary_result_version, ds.scheduled_paid_hrs, ds.result_status,
           ds.approved_regular_hrs, ds.approved_overtime_hrs, ds.approved_sunday_hrs,
           ds.approved_holiday_hrs, ds.leave_hrs, ds.unpaid_hrs, ds.attendance_classification,
           a.status AS adjustment_status,
           EXISTS (SELECT 1 FROM attendance_weekly_locks wl
             WHERE wl.week_start_date = date_trunc('week', de.work_date)::date
               AND wl.unlocked_at IS NULL) AS period_locked
    FROM attendance_day_exceptions de
    JOIN attendance_daily_summaries ds ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
    LEFT JOIN attendance_adjustments a ON a.id = de.adjustment_id AND a.entry_id = de.entry_id
    WHERE de.id = $1::uuid
    FOR UPDATE OF de, ds`, [exceptionId]);
}

async function writeDailyResult(
  tx: TxnClient, state: DecisionStateRow, input: DayExceptionDecisionInput,
  hours: ApprovedHours | null, classification: AttendanceClassification | null,
): Promise<number> {
  const row = input.action === 'return'
    ? await tx.queryOne<VersionRow>(`
      UPDATE attendance_daily_summaries SET result_status = 'awaiting_worker',
        approved_regular_hrs = NULL, approved_overtime_hrs = NULL,
        approved_sunday_hrs = NULL, approved_holiday_hrs = NULL,
        attendance_classification = NULL, approved_at = NULL, approved_by = NULL,
        result_version = result_version + 1, computed_at = NOW()
      WHERE staff_id = $1::uuid AND work_date = $2::date AND result_version = $3::bigint
      RETURNING result_version`, [state.staff_id, state.work_date, input.expectedResultVersion])
    : await tx.queryOne<VersionRow>(`
      UPDATE attendance_daily_summaries SET approved_regular_hrs = $4::numeric,
        approved_overtime_hrs = $5::numeric, approved_sunday_hrs = $6::numeric,
        approved_holiday_hrs = $7::numeric, leave_hrs = $8::numeric, unpaid_hrs = $9::numeric,
        attendance_classification = $10::text, result_status = CASE
          WHEN EXISTS (SELECT 1 FROM attendance_day_exceptions sibling
            WHERE sibling.staff_id = $1::uuid AND sibling.work_date = $2::date
              AND sibling.id <> $12::uuid
              AND sibling.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')) THEN 'awaiting_supervisor'
          ELSE 'approved' END,
        approved_at = CASE WHEN EXISTS (SELECT 1 FROM attendance_day_exceptions sibling
          WHERE sibling.staff_id = $1::uuid AND sibling.work_date = $2::date
            AND sibling.id <> $12::uuid
            AND sibling.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')) THEN NULL ELSE NOW() END,
        approved_by = CASE WHEN EXISTS (SELECT 1 FROM attendance_day_exceptions sibling
          WHERE sibling.staff_id = $1::uuid AND sibling.work_date = $2::date
            AND sibling.id <> $12::uuid
            AND sibling.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')) THEN NULL ELSE $11::uuid END,
        result_version = result_version + 1, computed_at = NOW()
      WHERE staff_id = $1::uuid AND work_date = $2::date AND result_version = $3::bigint
      RETURNING result_version`, [state.staff_id, state.work_date, input.expectedResultVersion,
      hours!.regular, hours!.overtime, hours!.sunday, hours!.holiday, hours!.leave, hours!.unpaid,
      classification, input.actor.id, state.exception_id]);
  const version = Number(row?.result_version);
  if (!Number.isInteger(version) || version !== input.expectedResultVersion + 1) {
    invalid('result_stale', 'Attendance result changed; reload before deciding');
  }
  return version;
}

async function writeAdjustment(tx: TxnClient, state: DecisionStateRow, input: DayExceptionDecisionInput): Promise<void> {
  if (!state.adjustment_id) return;
  const status = input.action === 'return' ? 'rejected' : 'approved';
  const row = await tx.queryOne<IdRow>(`
    UPDATE attendance_adjustments SET status = $2::text, reviewed_by = $3::uuid,
      reviewed_at = NOW(), review_note = $4::text, updated_at = NOW()
    WHERE id = $1::uuid AND status = 'pending' RETURNING id`,
  [state.adjustment_id, status, input.actor.id, input.reason]);
  if (!row) invalid('already_decided', 'Correction was already reviewed');
}

async function writeException(
  tx: TxnClient, state: DecisionStateRow, input: DayExceptionDecisionInput,
  version: number, classification: AttendanceClassification | null,
): Promise<void> {
  const row = input.action === 'return'
    ? await tx.queryOne<IdRow>(`
      UPDATE attendance_day_exceptions SET status = 'awaiting_worker', adjustment_id = NULL,
        classification = NULL, result_version = $2::bigint, resolved_by = NULL,
        resolved_at = NULL, resolution_reason = NULL, updated_at = NOW()
      WHERE id = $1::uuid AND status = 'awaiting_supervisor' RETURNING id`, [state.exception_id, version])
    : await tx.queryOne<IdRow>(`
      UPDATE attendance_day_exceptions SET status = 'resolved', classification = $2::text,
        result_version = $3::bigint, resolved_by = $4::uuid, resolved_at = NOW(),
        resolution_reason = $5::text, updated_at = NOW()
      WHERE id = $1::uuid AND status IN ('open', 'awaiting_worker', 'awaiting_supervisor') RETURNING id`,
    [state.exception_id, classification, version, input.actor.id, input.reason]);
  if (!row) invalid('already_decided', 'Attendance exception was already decided');
}

async function advanceSiblingVersions(tx: TxnClient, state: DecisionStateRow, version: number): Promise<void> {
  await tx.query(`
    UPDATE attendance_day_exceptions SET result_version = $3::bigint, updated_at = NOW()
    WHERE staff_id = $1::uuid AND work_date = $2::date AND id <> $4::uuid
      AND status IN ('open', 'awaiting_worker', 'awaiting_supervisor')`,
  [state.staff_id, state.work_date, version, state.exception_id]);
}

async function writeDecisionEvent(
  tx: TxnClient, state: DecisionStateRow, input: DayExceptionDecisionInput,
  version: number, hours: ApprovedHours | null, classification: AttendanceClassification | null,
): Promise<string> {
  const before = serializeJsonPayload({ status: state.status, resultVersion: Number(state.result_version),
    classification: state.attendance_classification, adjustmentStatus: state.adjustment_status });
  const after = serializeJsonPayload({ status: input.action === 'return' ? 'awaiting_worker' : 'resolved',
    resultVersion: version, classification, approvedHours: hours,
    adjustmentStatus: state.adjustment_id ? (input.action === 'return' ? 'rejected' : 'approved') : null });
  const row = await tx.queryOne<IdRow>(`
    INSERT INTO attendance_decision_events (
      entity_type, entity_key, action, actor_user_id, reason, before_value, after_value
    ) VALUES ('day_exception', $1, $2, $3::uuid, $4, $5::jsonb, $6::jsonb)
    RETURNING id`, [state.exception_id, input.action, input.actor.id, input.reason, before, after]);
  if (!row) throw new Error('Attendance decision event insert returned no row');
  return row.id;
}

async function readPersistedDecision(
  tx: TxnClient, exceptionId: string, eventId: string,
): Promise<DayExceptionDecisionResult> {
  const row = await tx.queryOne<PersistedRow>(`
    SELECT de.id AS exception_id, de.status AS exception_status,
           de.result_version AS exception_result_version,
           de.classification AS exception_classification, de.resolution_reason,
           ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date,
           ds.result_status, ds.result_version AS summary_result_version,
           ds.approved_regular_hrs, ds.approved_overtime_hrs,
           ds.approved_sunday_hrs, ds.approved_holiday_hrs,
           ds.leave_hrs, ds.unpaid_hrs, ds.attendance_classification
    FROM attendance_day_exceptions de
    JOIN attendance_daily_summaries ds ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
    WHERE de.id = $1::uuid`, [exceptionId]);
  if (!row) throw new Error('Attendance decision read-back returned no row');
  const numeric = (value: string | number | null): number => Number(value ?? 0);
  const approvedHours = row.approved_regular_hrs == null ? null : {
    regular: numeric(row.approved_regular_hrs), overtime: numeric(row.approved_overtime_hrs),
    sunday: numeric(row.approved_sunday_hrs), holiday: numeric(row.approved_holiday_hrs),
    leave: numeric(row.leave_hrs), unpaid: numeric(row.unpaid_hrs),
  };
  const version = numeric(row.summary_result_version);
  if (!Number.isInteger(version) || version < 1 || numeric(row.exception_result_version) !== version) {
    throw new Error('Attendance decision read-back versions do not match');
  }
  return {
    exception: { id: row.exception_id, status: row.exception_status, resultVersion: version,
      classification: row.exception_classification, resolutionReason: row.resolution_reason },
    dailyResult: { staffId: row.staff_id, workDate: row.work_date, status: row.result_status,
      resultVersion: version, approvedHours, attendanceClassification: row.attendance_classification },
    decisionEventId: eventId,
  };
}
