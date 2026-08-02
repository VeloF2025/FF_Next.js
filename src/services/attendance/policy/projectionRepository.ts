import { transaction, type TxnClient } from '@/lib/db-pool';
import { serializeJsonPayload } from './jsonPayloadValidation';
import { assertDailyProjectionUnlocked, guardProjectionDay } from './projectionLockGuard';
import {
  approvedBucketsForResult,
  insertProjection,
  refreshComputedAt,
  replaceProjection,
} from './projectionStatements';
import type { CalculatedDailyResult } from './types';

interface ProjectionRow extends Record<string, unknown> {
  calculation_fingerprint: string | null;
  result_version: string | number;
  result_status: string;
  approved_regular_hrs: string | null;
  approved_overtime_hrs: string | null;
  approved_sunday_hrs: string | null;
  approved_holiday_hrs: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

interface PolicyRuleRow extends Record<string, unknown> {
  overtime_rule_id: string | null;
}
interface IdRow extends Record<string, unknown> { id: string }

export interface ProjectionArgs {
  staffId: string;
  policyId: string;
  result: CalculatedDailyResult;
}
export interface SyncDayExceptionsArgs {
  staffId: string;
  entryId: string | null;
  resultVersion: number;
  result: CalculatedDailyResult;
}

export async function persistCalculatedDay(args: ProjectionArgs & { entryId: string | null }): Promise<{
  resultVersion: number;
  exceptionIds: string[];
}> {
  return transaction(async (tx) => {
    const projection = await upsertDailyProjectionTxn(tx, args);
    const exceptionIds = await syncDayExceptionsTxn(tx, {
      staffId: args.staffId,
      entryId: args.entryId,
      resultVersion: projection.resultVersion,
      result: args.result,
    });
    return { resultVersion: projection.resultVersion, exceptionIds };
  });
}

export async function upsertDailyProjectionTxn(
  tx: TxnClient,
  args: ProjectionArgs,
): Promise<{ resultVersion: number }> {
  // Validate before the lock query so an invalid JSONB payload causes zero SQL.
  serializeJsonPayload(args.result.exceptionKinds);
  await guardProjectionDay(tx, args.staffId, args.result.workDate);
  const existing = await tx.queryOne<ProjectionRow>(`
    SELECT calculation_fingerprint, result_version, result_status,
           approved_regular_hrs::text, approved_overtime_hrs::text,
           approved_sunday_hrs::text, approved_holiday_hrs::text,
           approved_at::text, approved_by::text
    FROM attendance_daily_summaries
    WHERE staff_id = $1::uuid AND work_date = $2::date
    FOR UPDATE`, [args.staffId, args.result.workDate]);

  assertDailyProjectionUnlocked(existing?.result_status);

  if (!existing) {
    const overtimeRuleId = await loadPolicyOvertimeRuleId(tx, args.policyId);
    const blockingReasons = serializeJsonPayload(args.result.exceptionKinds);
    return { resultVersion: resultVersion(await insertProjection(tx, args, blockingReasons, overtimeRuleId)) };
  }
  if (existing.calculation_fingerprint === args.result.calculationFingerprint) {
    if (needsAutoApprovalRepair(existing, args.result)) {
      const blockingReasons = serializeJsonPayload(args.result.exceptionKinds);
      return { resultVersion: resultVersion(await replaceProjection(tx, args, blockingReasons)) };
    }
    return { resultVersion: resultVersion(await refreshComputedAt(tx, args)) };
  }
  const blockingReasons = serializeJsonPayload(args.result.exceptionKinds);
  return { resultVersion: resultVersion(await replaceProjection(tx, args, blockingReasons)) };
}

function needsAutoApprovalRepair(
  existing: ProjectionRow,
  result: CalculatedDailyResult,
): boolean {
  if (result.status !== 'approved' || existing.result_status !== 'approved' ||
      existing.approved_by != null) return false;
  const approved = approvedBucketsForResult(result);
  if (!approved || existing.approved_at == null) return true;
  return ![
    [existing.approved_regular_hrs, approved.regular],
    [existing.approved_overtime_hrs, approved.overtime],
    [existing.approved_sunday_hrs, approved.sunday],
    [existing.approved_holiday_hrs, approved.holiday],
  ].every(([actual, expected]) => actual != null && Number(actual) === expected);
}

export async function syncDayExceptionsTxn(
  tx: TxnClient,
  args: SyncDayExceptionsArgs,
): Promise<string[]> {
  const kinds = [...new Set(args.result.exceptionKinds)];
  const exceptionIds: string[] = [];

  for (const kind of kinds) {
    const idempotencyKey = `attendance:${args.result.workDate}:${kind}:${args.staffId}`;
    const row = args.entryId
      ? await insertExceptionWithEntry(tx, args, kind, idempotencyKey)
      : await insertExceptionWithoutEntry(tx, args, kind, idempotencyKey);
    if (!row) throw new Error(`Unable to persist attendance exception ${idempotencyKey}`);
    exceptionIds.push(row.id);
  }

  await tx.query(`
    UPDATE attendance_day_exceptions
    SET status = 'cancelled', updated_at = NOW()
    WHERE staff_id = $1::uuid
      AND work_date = $2::date
      AND kind <> ALL($3::text[])
      AND adjustment_id IS NULL
      AND status IN ('open', 'awaiting_worker', 'awaiting_supervisor')`,
  [args.staffId, args.result.workDate, kinds]);

  return exceptionIds;
}

async function loadPolicyOvertimeRuleId(tx: TxnClient, policyId: string): Promise<string> {
  const policy = await tx.queryOne<PolicyRuleRow>(`
    SELECT overtime_rule_id
    FROM attendance_schedule_policies
    WHERE id = $1::uuid
    FOR KEY SHARE`, [policyId]);
  if (!policy) throw new Error(`Attendance schedule policy ${policyId} was not found`);
  if (!policy.overtime_rule_id) {
    throw new Error(`Attendance schedule policy ${policyId} has no overtime_rule_id for legacy rule_id`);
  }
  return policy.overtime_rule_id;
}

function resultVersion(row: { result_version: string | number } | null): number {
  const version = Number(row?.result_version);
  if (!Number.isInteger(version) || version < 1) throw new Error('Attendance projection did not return a result version');
  return version;
}

function exceptionStatus(result: CalculatedDailyResult): 'open' | 'awaiting_worker' | 'awaiting_supervisor' {
  if (result.status === 'awaiting_worker') return 'awaiting_worker';
  if (result.status === 'awaiting_supervisor' || result.status === 'absence_review') return 'awaiting_supervisor';
  return 'open';
}

function proposedHoursFor(result: CalculatedDailyResult): Record<string, number | null> {
  return {
    scheduledPaidHours: result.scheduledPaidHours,
    recordedElapsedHours: result.recordedElapsedHours,
    proposedRegularHours: result.proposedRegularHours,
    proposedOvertimeHours: result.proposedOvertimeHours,
    proposedSundayHours: result.proposedSundayHours,
    proposedHolidayHours: result.proposedHolidayHours,
    leaveHours: result.leaveHours,
    unpaidHours: result.unpaidHours,
  };
}

async function insertExceptionWithEntry(
  tx: TxnClient, args: SyncDayExceptionsArgs, kind: string, key: string,
): Promise<IdRow | null> {
  const proposedHours = serializeJsonPayload(proposedHoursFor(args.result));
  return tx.queryOne<IdRow>(`
    INSERT INTO attendance_day_exceptions (
      staff_id, work_date, entry_id, kind, status, proposed_hours, classification, idempotency_key, result_version
    ) VALUES (
      $1::uuid, $2::date, $3::uuid, $4::text, $5::text, $6::jsonb, $7::text, $8::text, $9::bigint
    )
    ON CONFLICT (idempotency_key) DO UPDATE
      SET entry_id = EXCLUDED.entry_id,
          status = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.status
            WHEN attendance_day_exceptions.adjustment_id IS NOT NULL
              AND attendance_day_exceptions.status = 'awaiting_supervisor'
              THEN attendance_day_exceptions.status
            ELSE EXCLUDED.status
          END,
          proposed_hours = EXCLUDED.proposed_hours,
          classification = EXCLUDED.classification,
          result_version = EXCLUDED.result_version,
          resolved_by = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.resolved_by ELSE NULL END,
          resolved_at = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.resolved_at ELSE NULL END,
          resolution_reason = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.resolution_reason ELSE NULL END,
          updated_at = NOW()
    RETURNING id`, [
    args.staffId, args.result.workDate, args.entryId, kind, exceptionStatus(args.result), proposedHours,
    args.result.attendanceClassification, key, args.resultVersion,
  ]);
}

async function insertExceptionWithoutEntry(
  tx: TxnClient, args: SyncDayExceptionsArgs, kind: string, key: string,
): Promise<IdRow | null> {
  const proposedHours = serializeJsonPayload(proposedHoursFor(args.result));
  return tx.queryOne<IdRow>(`
    INSERT INTO attendance_day_exceptions (
      staff_id, work_date, entry_id, kind, status, proposed_hours, classification, idempotency_key, result_version
    ) VALUES (
      $1::uuid, $2::date, NULL::uuid, $3::text, $4::text, $5::jsonb, $6::text, $7::text, $8::bigint
    )
    ON CONFLICT (idempotency_key) DO UPDATE
      SET entry_id = EXCLUDED.entry_id,
          status = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.status
            WHEN attendance_day_exceptions.adjustment_id IS NOT NULL
              AND attendance_day_exceptions.status = 'awaiting_supervisor'
              THEN attendance_day_exceptions.status
            ELSE EXCLUDED.status
          END,
          proposed_hours = EXCLUDED.proposed_hours,
          classification = EXCLUDED.classification,
          result_version = EXCLUDED.result_version,
          resolved_by = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.resolved_by ELSE NULL END,
          resolved_at = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.resolved_at ELSE NULL END,
          resolution_reason = CASE
            WHEN attendance_day_exceptions.status IN ('resolved', 'cancelled')
              THEN attendance_day_exceptions.resolution_reason ELSE NULL END,
          updated_at = NOW()
    RETURNING id`, [
    args.staffId, args.result.workDate, kind, exceptionStatus(args.result), proposedHours,
    args.result.attendanceClassification, key, args.resultVersion,
  ]);
}
