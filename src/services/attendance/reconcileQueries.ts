import { query } from '@/lib/db-pool';
import type { OvertimeRuleInput } from './overtimeCalculator';
import type { AttendanceSchedulePolicy } from './policy/types';
import { employmentEffectivePredicate } from './employmentUniverse';

export interface OpenEntryRow extends Record<string, unknown> {
  id: string;
  staff_id: string;
  work_date: string;
  clock_in_at: string;
}

export interface ReconciliationEntryRow extends OpenEntryRow {
  clock_out_at: string | null;
  site_geofence_id: string | null;
  status: 'open' | 'closed' | 'auto_closed' | 'manual';
  bcea_applicable: boolean;
  ordinarily_works_sundays: boolean;
  hourly_rate: string | null;
  calculation_fingerprint: string | null;
  result_version: string | number | null;
}

export interface ExpectedAttendanceDay extends Record<string, unknown> {
  staff_id: string;
  work_date: string;
  is_public_holiday: boolean;
  public_holiday_name: string | null;
  calculation_fingerprint: string | null;
  result_version: string | number | null;
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

interface EffectivePolicyRow extends Record<string, unknown> {
  id: string;
  timezone: string;
  weekday_start: string;
  weekday_end: string;
  weekday_unpaid_break_minutes: number;
  weekday_paid_cap_hrs: string;
  saturday_start: string;
  saturday_end: string;
  saturday_paid_cap_hrs: string;
  sunday_scheduled: boolean;
  sunday_missing_out_cap_hrs: string;
  late_alert_minutes: number;
}

export interface AttendancePolicyReader {
  <T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export async function loadEffectivePolicy(
  workDate: string,
  reader: AttendancePolicyReader = query,
): Promise<AttendanceSchedulePolicy> {
  const policy = await findEffectivePolicy(workDate, reader);
  if (!policy) throw new Error(`No effective attendance schedule policy for ${workDate}`);
  return policy;
}

/**
 * Same lookup as loadEffectivePolicy, but absence of a policy is a return
 * value rather than a throw. A misconfigured policy (wrong timezone) still
 * throws — that is a configuration error, not an uncovered date.
 */
export async function findEffectivePolicy(
  workDate: string,
  reader: AttendancePolicyReader = query,
): Promise<AttendanceSchedulePolicy | null> {
  const rows = await reader<EffectivePolicyRow>(`
    SELECT id, timezone,
           TO_CHAR(weekday_start, 'HH24:MI') AS weekday_start,
           TO_CHAR(weekday_end, 'HH24:MI') AS weekday_end,
           weekday_unpaid_break_minutes, weekday_paid_cap_hrs::text,
           TO_CHAR(saturday_start, 'HH24:MI') AS saturday_start,
           TO_CHAR(saturday_end, 'HH24:MI') AS saturday_end,
           saturday_paid_cap_hrs::text, sunday_scheduled,
           sunday_missing_out_cap_hrs::text, late_alert_minutes
    FROM attendance_schedule_policies
    WHERE active_from <= $1::date
      AND (active_to IS NULL OR active_to >= $2::date)
    ORDER BY active_from DESC
    LIMIT 1`, [workDate, workDate]);
  const policy = rows[0];
  if (!policy) return null;
  if (policy.timezone !== 'Africa/Johannesburg') {
    throw new Error(`Attendance policy timezone must be Africa/Johannesburg; got ${policy.timezone}`);
  }
  return {
    id: policy.id,
    timezone: 'Africa/Johannesburg',
    weekdayStart: fixed(policy.weekday_start, '08:00', 'weekday_start'),
    weekdayEnd: fixed(policy.weekday_end, '17:00', 'weekday_end'),
    weekdayUnpaidBreakMinutes: fixed(policy.weekday_unpaid_break_minutes, 60, 'weekday_unpaid_break_minutes'),
    weekdayPaidCapHours: fixed(Number(policy.weekday_paid_cap_hrs), 8, 'weekday_paid_cap_hrs'),
    saturdayStart: fixed(policy.saturday_start, '08:00', 'saturday_start'),
    saturdayEnd: fixed(policy.saturday_end, '13:00', 'saturday_end'),
    saturdayPaidCapHours: fixed(Number(policy.saturday_paid_cap_hrs), 5, 'saturday_paid_cap_hrs'),
    sundayScheduled: fixed(policy.sunday_scheduled, false, 'sunday_scheduled'),
    sundayMissingOutCapHours: fixed(Number(policy.sunday_missing_out_cap_hrs), 5, 'sunday_missing_out_cap_hrs'),
    lateAlertMinutes: fixed(policy.late_alert_minutes, 15, 'late_alert_minutes'),
  };
}

/**
 * True when at least one policy covers at least one day in [fromDate, toDate].
 * Distinguishes "the window end happens to be uncovered" — normal, and safe to
 * continue past — from "nothing in this window is covered at all", which is a
 * misconfiguration that must fail loudly rather than report a zero-count success.
 */
export async function policyCoversAnyDayInRange(
  fromDate: string,
  toDate: string,
  reader: AttendancePolicyReader = query,
): Promise<boolean> {
  const rows = await reader<{ covered: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM attendance_schedule_policies
      WHERE active_from <= $2::date
        AND (active_to IS NULL OR active_to >= $1::date)
    ) AS covered`, [fromDate, toDate]);
  return rows[0]?.covered === true;
}

export async function loadOpenEntriesForReconciliation(
  fromDate: string,
  toDate: string,
): Promise<OpenEntryRow[]> {
  return query<OpenEntryRow>(`
    SELECT attendance_entries.id, attendance_entries.staff_id,
           attendance_entries.clock_in_at::text,
           TO_CHAR(attendance_entries.work_date, 'YYYY-MM-DD') AS work_date
    FROM attendance_entries
    JOIN staff s ON s.id = attendance_entries.staff_id
    WHERE attendance_entries.status = 'open'
      AND attendance_entries.work_date >= $1::date
      AND attendance_entries.work_date <= $2::date
      AND attendance_entries.work_date < (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
      AND NOT EXISTS (
        SELECT 1 FROM attendance_adjustments approved_out
        WHERE approved_out.entry_id = attendance_entries.id
          AND approved_out.status = 'approved'
          AND approved_out.adjusted_clock_out_at IS NOT NULL
      )
      AND ${employmentEffectivePredicate('s', 'attendance_entries.work_date')}
      AND EXISTS (
        SELECT 1 FROM attendance_schedule_policies
        WHERE active_from <= attendance_entries.work_date
          AND (active_to IS NULL OR active_to >= attendance_entries.work_date)
      )
    ORDER BY attendance_entries.staff_id ASC, attendance_entries.work_date ASC,
             attendance_entries.clock_in_at ASC`, [fromDate, toDate]);
}

export async function loadReconciliationEntries(
  fromDate: string,
  toDate: string,
): Promise<ReconciliationEntryRow[]> {
  return query<ReconciliationEntryRow>(`
    SELECT e.id, e.staff_id, TO_CHAR(e.work_date, 'YYYY-MM-DD') AS work_date,
           COALESCE(approved_adjustment.adjusted_clock_in_at, e.clock_in_at)::text AS clock_in_at,
           COALESCE(approved_adjustment.adjusted_clock_out_at, e.clock_out_at)::text AS clock_out_at,
           COALESCE(approved_adjustment.adjusted_site_geofence_id, e.site_geofence_id)::text AS site_geofence_id,
           CASE WHEN approved_adjustment.adjusted_clock_out_at IS NOT NULL
             THEN 'manual' ELSE e.status END AS status,
           COALESCE(s.bcea_applicable, true) AS bcea_applicable,
           COALESCE(s.ordinarily_works_sundays, false) AS ordinarily_works_sundays,
           COALESCE((rac.hourly_rate_cents::numeric / 100)::text, s.hourly_rate::text) AS hourly_rate,
           ds.calculation_fingerprint, ds.result_version
    FROM attendance_entries e
    JOIN staff s ON s.id = e.staff_id
    LEFT JOIN staff_rate_at_clock_in rac ON rac.entry_id = e.id
    LEFT JOIN attendance_daily_summaries ds
      ON ds.staff_id = e.staff_id AND ds.work_date = e.work_date
    LEFT JOIN LATERAL (
      SELECT
        (SELECT adjusted_clock_in_at FROM attendance_adjustments
          WHERE entry_id = e.id AND status = 'approved' AND adjusted_clock_in_at IS NOT NULL
          ORDER BY reviewed_at DESC NULLS LAST, updated_at DESC, id DESC LIMIT 1
        ) AS adjusted_clock_in_at,
        (SELECT adjusted_clock_out_at FROM attendance_adjustments
          WHERE entry_id = e.id AND status = 'approved' AND adjusted_clock_out_at IS NOT NULL
          ORDER BY reviewed_at DESC NULLS LAST, updated_at DESC, id DESC LIMIT 1
        ) AS adjusted_clock_out_at,
        (SELECT adjusted_site_geofence_id FROM attendance_adjustments
          WHERE entry_id = e.id AND status = 'approved' AND adjusted_site_geofence_id IS NOT NULL
          ORDER BY reviewed_at DESC NULLS LAST, updated_at DESC, id DESC LIMIT 1
        ) AS adjusted_site_geofence_id
    ) approved_adjustment ON true
    WHERE e.status IN ('open', 'closed', 'auto_closed', 'manual')
      AND e.work_date >= $1::date
      AND e.work_date <= $2::date
      AND e.work_date < (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
      AND ${employmentEffectivePredicate('s', 'e.work_date')}
      AND EXISTS (
        SELECT 1 FROM attendance_schedule_policies policy
        WHERE policy.active_from <= e.work_date
          AND (policy.active_to IS NULL OR policy.active_to >= e.work_date)
      )
    ORDER BY e.staff_id ASC, e.work_date ASC,
             COALESCE(approved_adjustment.adjusted_clock_in_at, e.clock_in_at) ASC`, [fromDate, toDate]);
}

export async function loadExpectedAttendanceDays(
  fromDate: string,
  toDate: string,
  reader: AttendancePolicyReader = query,
): Promise<ExpectedAttendanceDay[]> {
  return reader<ExpectedAttendanceDay>(`
    WITH workdays AS (
      SELECT day::date AS work_date
      FROM generate_series($1::date, $2::date, INTERVAL '1 day') AS days(day)
      WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6
    )
    SELECT s.id AS staff_id, TO_CHAR(w.work_date, 'YYYY-MM-DD') AS work_date,
           (ph.date IS NOT NULL) AS is_public_holiday, ph.name AS public_holiday_name,
           ds.calculation_fingerprint, ds.result_version
    FROM staff s
    CROSS JOIN workdays w
    LEFT JOIN public_holidays ph ON ph.date = w.work_date
    LEFT JOIN attendance_daily_summaries ds
      ON ds.staff_id = s.id AND ds.work_date = w.work_date
    WHERE ${employmentEffectivePredicate('s', 'w.work_date')}
      AND EXISTS (
        SELECT 1 FROM attendance_schedule_policies policy
        WHERE policy.active_from <= w.work_date
          AND (policy.active_to IS NULL OR policy.active_to >= w.work_date)
      )
    ORDER BY w.work_date ASC, s.id ASC`, [fromDate, toDate]);
}

export async function loadDefaultRule(): Promise<OvertimeRuleInput> {
  const rows = await query<DefaultRuleRow>(`
    SELECT id, daily_ordinary_hrs, weekly_ordinary_hrs, weekly_ot_cap_hrs,
           ot_multiplier, sunday_multiplier_default, sunday_ordinary_multiplier,
           holiday_multiplier, night_shift_allowance,
           TO_CHAR(night_start, 'HH24:MI') AS night_start,
           TO_CHAR(night_end, 'HH24:MI') AS night_end
    FROM attendance_overtime_rules
    WHERE is_default = true AND is_active = true
    LIMIT 1`);
  const row = rows[0];
  if (!row) throw new Error('reconcile: no active default attendance_overtime_rules row found');
  return {
    id: row.id,
    dailyOrdinaryHrs: Number(row.daily_ordinary_hrs),
    weeklyOrdinaryHrs: Number(row.weekly_ordinary_hrs),
    weeklyOtCapHrs: Number(row.weekly_ot_cap_hrs),
    otMultiplier: Number(row.ot_multiplier),
    sundayMultiplierDefault: Number(row.sunday_multiplier_default),
    sundayOrdinaryMultiplier: Number(row.sunday_ordinary_multiplier),
    holidayMultiplier: Number(row.holiday_multiplier),
    nightShiftAllowance: Number(row.night_shift_allowance),
    nightStart: row.night_start,
    nightEnd: row.night_end,
  };
}

export async function loadPersistedWeeklyOtBefore(
  staffId: string,
  weekMonday: string,
  firstRecomputeDate: string,
): Promise<number> {
  const rows = await query<{ total: string | null }>(`
    SELECT SUM(overtime_hrs)::text AS total
    FROM attendance_daily_summaries
    WHERE staff_id = $1::uuid
      AND work_date >= $2::date
      AND work_date < $3::date`, [staffId, weekMonday, firstRecomputeDate]);
  const total = Number(rows[0]?.total ?? 0);
  if (!Number.isFinite(total)) throw new Error('Persisted weekly overtime total is non-numeric');
  return total;
}

function fixed<T extends string | number | boolean>(value: string | number | boolean, expected: T, field: string): T {
  if (value !== expected) throw new Error(`Attendance policy ${field} must be ${String(expected)}`);
  return expected;
}
