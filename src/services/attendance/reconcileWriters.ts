/**
 * Write-side SQL helpers for the reconcile orchestrator.
 *
 * Split out of reconcile.ts to keep each file under CLAUDE.md's 300-line
 * cap and to make the write paths easy to audit in isolation.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { DailySummary } from './overtimeCalculator';
import type { OpenEntryRow } from './reconcileQueries';

/**
 * Atomically close a single dangling entry and raise a `missing_clock_out`
 * exception. Uses `RETURNING id` so that when the UPDATE's
 * `status = 'open'` guard fails (the staff concurrently clocked out via the
 * /my portal between our SELECT and UPDATE), we do NOT insert a phantom
 * exception on a legitimate clock-out. Returns true iff the entry was
 * actually auto-closed by this call.
 */
export async function autoCloseOneEntry(
  row: OpenEntryRow,
  autoCloseAfterHrs: number,
  autoCloseCapHrs: number
): Promise<boolean> {
  try {
    const capMs = autoCloseCapHrs * 60 * 60 * 1000;
    const assumedOutAt = new Date(
      new Date(row.clock_in_at).getTime() + capMs
    );
    const updated = await sql<{ id: string }>`
      UPDATE attendance_entries
      SET status          = 'auto_closed',
          clock_out_at    = ${assumedOutAt.toISOString()},
          received_at_out = NOW(),
          updated_at      = NOW(),
          notes           = COALESCE(notes, '') ||
                            CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END ||
                            '[auto-closed by reconcile cron at ' || NOW()::text || ']'
      WHERE id = ${row.id} AND status = 'open'
      RETURNING id
    `;
    if (updated.length === 0) {
      // Lost the race with a concurrent user clock-out. Not an error —
      // the entry is closed by the correct path. Do NOT insert an exception.
      log.info(
        '[attendance-reconcile] auto-close no-op — entry was concurrently closed',
        { entryId: row.id, staffId: row.staff_id }
      );
      return false;
    }
    await sql`
      INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
      VALUES (
        ${row.id},
        'missing_clock_out',
        'warning',
        jsonb_build_object(
          'auto_close_after_hrs', ${autoCloseAfterHrs}::int,
          'cap_hrs', ${autoCloseCapHrs}::int,
          'original_clock_in_at', ${row.clock_in_at}
        )
      )
    `;
    return true;
  } catch (err) {
    log.error('[attendance-reconcile] failed to auto-close entry', {
      entryId: row.id,
      staffId: row.staff_id,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export interface UpsertSummaryExtras {
  /**
   * Wage (cents) computed by wageCalculator.computeWageCents. Null
   * when we couldn't compute (missing rate / incomplete summary).
   * Migration 324's CHECK constraint pairs this with the rate snapshot
   * — both must be null or both non-null.
   */
  wageAmountCents: number | null;
  hourlyRateSnapshotCents: number | null;
}

export async function upsertSummary(
  staffId: string,
  workDate: string,
  summary: DailySummary,
  extras: UpsertSummaryExtras = {
    wageAmountCents: null,
    hourlyRateSnapshotCents: null,
  }
): Promise<void> {
  await sql`
    INSERT INTO attendance_daily_summaries (
      staff_id, work_date,
      regular_hrs, overtime_hrs, sunday_hrs, holiday_hrs, night_hrs,
      rule_id, computation_mode,
      wage_amount_cents, hourly_rate_snapshot_cents,
      computed_at
    ) VALUES (
      ${staffId}, ${workDate}::date,
      ${summary.regularHrs}, ${summary.overtimeHrs},
      ${summary.sundayHrs}, ${summary.holidayHrs}, ${summary.nightHrs},
      ${summary.ruleId}, ${summary.computationMode},
      ${extras.wageAmountCents}, ${extras.hourlyRateSnapshotCents},
      NOW()
    )
    ON CONFLICT (staff_id, work_date) DO UPDATE
      SET regular_hrs                = EXCLUDED.regular_hrs,
          overtime_hrs               = EXCLUDED.overtime_hrs,
          sunday_hrs                 = EXCLUDED.sunday_hrs,
          holiday_hrs                = EXCLUDED.holiday_hrs,
          night_hrs                  = EXCLUDED.night_hrs,
          rule_id                    = EXCLUDED.rule_id,
          computation_mode           = EXCLUDED.computation_mode,
          wage_amount_cents          = EXCLUDED.wage_amount_cents,
          hourly_rate_snapshot_cents = EXCLUDED.hourly_rate_snapshot_cents,
          computed_at                = EXCLUDED.computed_at
  `;
}

export async function raiseCapViolation(
  entryId: string,
  weeklyTotalAfter: number,
  cap: number
): Promise<void> {
  await sql`
    INSERT INTO attendance_exceptions (entry_id, exception_kind, severity, details)
    VALUES (
      ${entryId},
      'out_of_hours',
      'critical',
      jsonb_build_object(
        'reason', 'weekly_ot_cap_exceeded',
        'weekly_ot_hrs', ${weeklyTotalAfter},
        'cap_hrs', ${cap}
      )
    )
  `;
}
