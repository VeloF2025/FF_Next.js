/**
 * Read-side SQL helpers for the reconcile orchestrator.
 *
 * Split out of reconcile.ts to keep each file under CLAUDE.md's 300-line cap
 * and to make the orchestrator easier to follow. Writers live in
 * reconcileWriters.ts.
 */

import { sql } from '@/lib/db-pool';
import type { OvertimeRuleInput } from './overtimeCalculator';

export interface OpenEntryRow extends Record<string, unknown> {
  id: string;
  staff_id: string;
  clock_in_at: string;
  work_date: string;
}

export interface ClosedEntryRow extends Record<string, unknown> {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_at: string;
  clock_out_at: string;
  bcea_applicable: boolean;
  ordinarily_works_sundays: boolean;
  /**
   * numeric(8,2) from staff.hourly_rate as a text string (or null when
   * the staff has no rate set — typical for salaried staff not yet
   * converted to hourly tracking). Threaded through to wageCalculator.
   * Captured AT RECONCILE TIME, not at clock_in — a rate change between
   * clock-in and reconcile applies the newer rate. True point-in-time
   * rates would need a separate staff_rate_history table (deferred).
   */
  hourly_rate: string | null;
}

interface DefaultRuleRow extends Record<string, unknown> {
  id: string;
  daily_ordinary_hrs: string;
  weekly_ordinary_hrs: string;
  weekly_ot_cap_hrs: string;
  ot_multiplier: string;
  sunday_multiplier_default: string;
  sunday_ordinary_multiplier: string;
  holiday_multiplier: string;
  night_shift_allowance: string;
  night_start: string;
  night_end: string;
}

export async function loadDefaultRule(): Promise<OvertimeRuleInput> {
  const rows = await sql<DefaultRuleRow>`
    SELECT id, daily_ordinary_hrs, weekly_ordinary_hrs, weekly_ot_cap_hrs,
           ot_multiplier, sunday_multiplier_default, sunday_ordinary_multiplier,
           holiday_multiplier, night_shift_allowance,
           TO_CHAR(night_start, 'HH24:MI') AS night_start,
           TO_CHAR(night_end,   'HH24:MI') AS night_end
    FROM attendance_overtime_rules
    WHERE is_default = true AND is_active = true
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) {
    throw new Error(
      'reconcile: no active default attendance_overtime_rules row found — ' +
        'cannot compute daily summaries. Seed the BCEA default rule first.'
    );
  }
  return {
    id: r.id,
    dailyOrdinaryHrs: Number(r.daily_ordinary_hrs),
    weeklyOrdinaryHrs: Number(r.weekly_ordinary_hrs),
    weeklyOtCapHrs: Number(r.weekly_ot_cap_hrs),
    otMultiplier: Number(r.ot_multiplier),
    sundayMultiplierDefault: Number(r.sunday_multiplier_default),
    sundayOrdinaryMultiplier: Number(r.sunday_ordinary_multiplier),
    holidayMultiplier: Number(r.holiday_multiplier),
    nightShiftAllowance: Number(r.night_shift_allowance),
    nightStart: r.night_start,
    nightEnd: r.night_end,
  };
}

export async function loadOpenEntriesOlderThan(
  autoCloseAfterHrs: number
): Promise<OpenEntryRow[]> {
  return sql<OpenEntryRow>`
    SELECT id, staff_id, clock_in_at::text, work_date::text
    FROM attendance_entries
    WHERE status = 'open'
      AND clock_in_at < NOW() - (${autoCloseAfterHrs}::int * INTERVAL '1 hour')
    ORDER BY clock_in_at ASC
  `;
}

export async function loadClosedEntriesMissingSummary(
  fromDate: string,
  toDate: string
): Promise<ClosedEntryRow[]> {
  return sql<ClosedEntryRow>`
    SELECT e.id,
           e.staff_id,
           e.work_date::text,
           e.clock_in_at::text,
           e.clock_out_at::text,
           COALESCE(s.bcea_applicable, true) AS bcea_applicable,
           COALESCE(s.ordinarily_works_sundays, false) AS ordinarily_works_sundays,
           s.hourly_rate::text AS hourly_rate
    FROM attendance_entries e
    JOIN staff s ON s.id = e.staff_id
    LEFT JOIN attendance_daily_summaries ds
      ON ds.staff_id = e.staff_id AND ds.work_date = e.work_date
    WHERE e.status IN ('closed', 'auto_closed', 'manual')
      AND e.clock_out_at IS NOT NULL
      AND e.work_date >= ${fromDate}::date
      AND e.work_date <= ${toDate}::date
      AND ds.computed_at IS NULL
    ORDER BY e.staff_id ASC, e.work_date ASC, e.clock_in_at ASC
  `;
}

/**
 * Persisted OT within the given ISO-week STRICTLY BEFORE `firstRecomputeDate`.
 *
 * Previous implementation excluded any date being recomputed, but that
 * invited a mid-week backfill to credit Sat/Sun OT as "before" Mon-Fri,
 * which violates the calculator's strict-chronological-before contract
 * and could produce spurious BCEA-s10 cap-exceeded exceptions. Bounded
 * seed = everything persisted on `work_date < firstRecomputeDate`.
 */
export async function loadPersistedWeeklyOtBefore(
  staffId: string,
  weekMonday: string,
  firstRecomputeDate: string
): Promise<number> {
  const rows = await sql<{ total: string | null }>`
    SELECT SUM(overtime_hrs)::text AS total
    FROM attendance_daily_summaries
    WHERE staff_id = ${staffId}
      AND work_date >= ${weekMonday}::date
      AND work_date <  ${firstRecomputeDate}::date
  `;
  const total = rows[0]?.total;
  const n = Number(total ?? 0);
  if (!Number.isFinite(n)) {
    throw new Error(
      `loadPersistedWeeklyOtBefore returned non-numeric total: ${String(total)}`
    );
  }
  return n;
}
