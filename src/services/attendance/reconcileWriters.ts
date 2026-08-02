import { query, transaction, type TxnClient } from '@/lib/db-pool';
import { serializeJsonPayload } from './policy/jsonPayloadValidation';
import { assertDailyProjectionUnlocked, guardProjectionDay } from './policy/projectionLockGuard';
import type { DailySummary } from './overtimeCalculator';
import type { OpenEntryRow } from './reconcileQueries';
import type { CalculatedDailyResult } from './policy/types';
import {
  syncDayExceptionsTxn,
  upsertDailyProjectionTxn,
} from './policy/projectionRepository';
import { acquireAttendanceStaffGateLock } from '@/modules/attendance/corrections/lockQueries';

export interface ReconciliationCounts {
  systemClosed: number;
  projectedDays: number;
  unchangedDays: number;
  skippedLockedDays: number;
  missingClockOutExceptions: number;
  missingClockInExceptions: number;
}

export interface FinishRunArgs {
  runId: string;
  schedulePolicyId: string | null;
  status: 'succeeded' | 'partial' | 'failed';
  counts: ReconciliationCounts;
  failedDayKeys: string[];
  errorMessage?: string | null;
  finishedAt: string;
}

interface IdRow extends Record<string, unknown> {
  id: string;
}

export async function systemCloseEntry(
  row: OpenEntryRow,
  policyId: string,
  result: CalculatedDailyResult,
): Promise<boolean> {
  return transaction(async (tx) => {
    await acquireAttendanceStaffGateLock(tx, row.staff_id);
    await guardReconciliationDay(tx, row.staff_id, row.work_date);
    const updated = await tx.query<IdRow>(`
      UPDATE attendance_entries
      SET status = 'auto_closed',
          notes = CONCAT_WS(E'\n', NULLIF(notes, ''),
            '[system: attendance reconciliation operational closure; clock-out evidence absent]'),
          updated_at = NOW()
      WHERE id = $1::uuid
        AND work_date = $2::date
        AND status = 'open'
        AND work_date < (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
        AND EXISTS (
          SELECT 1 FROM attendance_schedule_policies
          WHERE active_from <= attendance_entries.work_date
            AND (active_to IS NULL OR active_to >= attendance_entries.work_date)
        )
      RETURNING id`, [row.id, row.work_date]);
    if (updated.length !== 1) return false;
    const projection = await upsertDailyProjectionTxn(tx, {
      staffId: row.staff_id,
      policyId,
      result,
    });
    await syncDayExceptionsTxn(tx, {
      staffId: row.staff_id,
      entryId: row.id,
      resultVersion: projection.resultVersion,
      result,
    });
    return true;
  });
}

export async function startReconciliationRun(args: {
  runId: string;
  scannedFrom: string;
  scannedTo: string;
  startedAt: string;
}): Promise<void> {
  const counts = serializeJsonPayload({});
  const failedDayKeys = serializeJsonPayload([]);
  const rows = await query<IdRow>(`
    INSERT INTO attendance_reconciliation_runs (
      run_id, scanned_from, scanned_to, status, counts, failed_day_keys, started_at
    ) VALUES ($1, $2::date, $3::date, 'running', $4::jsonb, $5::jsonb, $6::timestamptz)
    RETURNING id`, [
    args.runId, args.scannedFrom, args.scannedTo, counts, failedDayKeys, args.startedAt,
  ]);
  if (rows.length !== 1) throw new Error(`Unable to start reconciliation run ${args.runId}`);
}

export async function finishReconciliationRun(args: FinishRunArgs): Promise<void> {
  const counts = serializeJsonPayload(args.counts);
  const failedDayKeys = serializeJsonPayload(args.failedDayKeys);
  const rows = await query<IdRow>(`
    UPDATE attendance_reconciliation_runs
    SET schedule_policy_id = $2::uuid,
        status = $3,
        counts = $4::jsonb,
        failed_day_keys = $5::jsonb,
        error_message = $6,
        finished_at = $7::timestamptz
    WHERE run_id = $1 AND status = 'running'
    RETURNING id`, [
    args.runId, args.schedulePolicyId, args.status, counts, failedDayKeys,
    args.errorMessage ?? null, args.finishedAt,
  ]);
  if (rows.length !== 1) throw new Error(`Unable to finish running reconciliation ${args.runId}`);
}

export interface UpsertSummaryExtras {
  wageAmountCents: number | null;
  hourlyRateSnapshotCents: number | null;
}

export async function upsertSummary(
  staffId: string,
  workDate: string,
  summary: DailySummary,
  extras: UpsertSummaryExtras = { wageAmountCents: null, hourlyRateSnapshotCents: null },
): Promise<void> {
  await transaction(async (tx) => {
    await guardReconciliationDay(tx, staffId, workDate);
    await tx.query(`
      INSERT INTO attendance_daily_summaries (
        staff_id, work_date, regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs,
        night_hrs, rule_id, computation_mode, wage_amount_cents,
        hourly_rate_snapshot_cents, computed_at
      ) VALUES (
        $1::uuid, $2::date, $3, $4, $5, $6, $7, $8::uuid, $9, $10, $11, NOW()
      )
      ON CONFLICT (staff_id, work_date) DO UPDATE
        SET regular_hrs = EXCLUDED.regular_hrs,
            overtime_hrs = EXCLUDED.overtime_hrs,
            sunday_hrs = EXCLUDED.sunday_hrs,
            holiday_hrs = EXCLUDED.holiday_hrs,
            night_hrs = EXCLUDED.night_hrs,
            rule_id = EXCLUDED.rule_id,
            computation_mode = EXCLUDED.computation_mode,
            wage_amount_cents = EXCLUDED.wage_amount_cents,
            hourly_rate_snapshot_cents = EXCLUDED.hourly_rate_snapshot_cents,
            computed_at = EXCLUDED.computed_at`, [
      staffId, workDate, summary.regularHrs, summary.overtimeHrs, summary.sundayHrs,
      summary.holidayHrs, summary.nightHrs, summary.ruleId, summary.computationMode,
      extras.wageAmountCents, extras.hourlyRateSnapshotCents,
    ]);
  });
}

async function guardReconciliationDay(tx: TxnClient, staffId: string, workDate: string): Promise<void> {
  await guardProjectionDay(tx, staffId, workDate);
  const row = await tx.queryOne<{ result_status: string }>(`
    SELECT result_status FROM attendance_daily_summaries
    WHERE staff_id = $1::uuid AND work_date = $2::date
    FOR UPDATE`, [staffId, workDate]);
  assertDailyProjectionUnlocked(row?.result_status);
}
