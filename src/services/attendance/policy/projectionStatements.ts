import type { TxnClient } from '@/lib/db-pool';

import { assertApprovedBucketInvariant } from './approvedBuckets';
import type { CalculatedDailyResult } from './types';

interface ProjectionWriteArgs {
  staffId: string;
  policyId: string;
  result: CalculatedDailyResult;
}

interface ResultVersionRow extends Record<string, unknown> {
  result_version: string | number;
}

export async function insertProjection(
  tx: TxnClient,
  args: ProjectionWriteArgs,
  blockingReasons: string,
  overtimeRuleId: string,
): Promise<ResultVersionRow | null> {
  return tx.queryOne<ResultVersionRow>(projectionInsertSql(), [
    ...projectionParams(args, blockingReasons), overtimeRuleId,
  ]);
}

export async function refreshComputedAt(
  tx: TxnClient,
  args: ProjectionWriteArgs,
): Promise<ResultVersionRow | null> {
  return tx.queryOne<ResultVersionRow>(`
    UPDATE attendance_daily_summaries
    SET computed_at = NOW()
    WHERE staff_id = $1::uuid AND work_date = $2::date
    RETURNING result_version`, [args.staffId, args.result.workDate]);
}

export async function replaceProjection(
  tx: TxnClient,
  args: ProjectionWriteArgs,
  blockingReasons: string,
): Promise<ResultVersionRow | null> {
  return tx.queryOne<ResultVersionRow>(`
    WITH replacement AS (
      SELECT NOT EXISTS (
        SELECT 1 FROM attendance_day_exceptions de
        JOIN attendance_adjustments a ON a.id = de.adjustment_id
        WHERE de.staff_id = $1::uuid AND de.work_date = $2::date
          AND de.adjustment_id IS NOT NULL
          AND de.status = 'awaiting_supervisor' AND a.status = 'pending'
      ) AS can_auto_approve
    )
    UPDATE attendance_daily_summaries ds
    SET schedule_policy_id = $3::uuid, scheduled_paid_hrs = $4::numeric,
        recorded_elapsed_hrs = $5::numeric, proposed_regular_hrs = $6::numeric,
        proposed_overtime_hrs = $7::numeric, proposed_sunday_hrs = $8::numeric,
        proposed_holiday_hrs = $9::numeric, leave_hrs = $10::numeric,
        unpaid_hrs = $11::numeric, attendance_classification = $12::text,
        result_status = CASE
          WHEN ds.result_status = 'awaiting_supervisor' AND NOT replacement.can_auto_approve
            THEN ds.result_status ELSE $13::text END,
        blocking_reasons = $14::jsonb, calculation_fingerprint = $15::text,
        approved_regular_hrs = CASE WHEN $13::text = 'approved' AND replacement.can_auto_approve
          THEN $16::numeric ELSE NULL END,
        approved_overtime_hrs = CASE WHEN $13::text = 'approved' AND replacement.can_auto_approve
          THEN $17::numeric ELSE NULL END,
        approved_sunday_hrs = CASE WHEN $13::text = 'approved' AND replacement.can_auto_approve
          THEN $18::numeric ELSE NULL END,
        approved_holiday_hrs = CASE WHEN $13::text = 'approved' AND replacement.can_auto_approve
          THEN $19::numeric ELSE NULL END,
        approved_at = CASE WHEN $13::text = 'approved' AND replacement.can_auto_approve
          THEN NOW() ELSE NULL END,
        approved_by = NULL,
        result_version = ds.result_version + 1, computed_at = NOW()
    FROM replacement
    WHERE ds.staff_id = $1::uuid AND ds.work_date = $2::date
    RETURNING ds.result_version`, projectionParams(args, blockingReasons));
}

function projectionInsertSql(): string {
  return `
    INSERT INTO attendance_daily_summaries (
      staff_id, work_date, rule_id, schedule_policy_id, scheduled_paid_hrs,
      recorded_elapsed_hrs, proposed_regular_hrs, proposed_overtime_hrs,
      proposed_sunday_hrs, proposed_holiday_hrs, leave_hrs, unpaid_hrs,
      attendance_classification, result_status, blocking_reasons, calculation_fingerprint,
      approved_regular_hrs, approved_overtime_hrs, approved_sunday_hrs,
      approved_holiday_hrs, approved_at, approved_by, computed_at
    ) VALUES (
      $1::uuid, $2::date, $20::uuid, $3::uuid, $4::numeric,
      $5::numeric, $6::numeric, $7::numeric, $8::numeric, $9::numeric,
      $10::numeric, $11::numeric, $12::text, $13::text, $14::jsonb, $15::text,
      $16::numeric, $17::numeric, $18::numeric, $19::numeric,
      CASE WHEN $13::text = 'approved' THEN NOW() ELSE NULL END, NULL::uuid, NOW()
    )
    RETURNING result_version`;
}

function projectionParams(args: ProjectionWriteArgs, blockingReasons: string): unknown[] {
  const result = args.result;
  const approved = approvedBucketsForResult(result);
  return [
    args.staffId, result.workDate, args.policyId, result.scheduledPaidHours,
    result.recordedElapsedHours, result.proposedRegularHours, result.proposedOvertimeHours,
    result.proposedSundayHours, result.proposedHolidayHours, result.leaveHours, result.unpaidHours,
    result.attendanceClassification, result.status, blockingReasons, result.calculationFingerprint,
    approved?.regular ?? null, approved?.overtime ?? null, approved?.sunday ?? null,
    approved?.holiday ?? null,
  ];
}

export function approvedBucketsForResult(result: CalculatedDailyResult) {
  if (result.status !== 'approved') return null;
  const buckets = {
    regular: result.attendanceClassification === 'site_shutdown_weather'
      ? result.scheduledPaidHours : result.proposedRegularHours ?? 0,
    overtime: result.proposedOvertimeHours,
    sunday: result.proposedSundayHours,
    holiday: result.attendanceClassification === 'public_holiday'
      ? result.proposedHolidayHours || result.scheduledPaidHours : result.proposedHolidayHours,
    leave: result.leaveHours,
    unpaid: result.unpaidHours,
  };
  if (result.attendanceClassification === 'public_holiday') buckets.regular = 0;
  assertApprovedBucketInvariant(result.attendanceClassification, buckets);
  return buckets;
}
