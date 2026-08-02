import { sql } from '@/lib/db-pool';
import { employmentEffectivePredicate } from '@/services/attendance/employmentUniverse';
import { approvedBucketInvariantSql } from '@/services/attendance/policy/approvedBuckets';

import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import { makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'worker', label: 'Worker' },
  { key: 'department', label: 'Department' },
  { key: 'expected_days', label: 'Expected', align: 'right', format: 'integer' },
  { key: 'approved_days', label: 'Approved', align: 'right', format: 'integer' },
  { key: 'blocked_days', label: 'Blocked', align: 'right', format: 'integer' },
  { key: 'readiness_status', label: 'Readiness' },
  { key: 'approved_regular_hours', label: 'Ordinary', align: 'right', format: 'number' },
  { key: 'approved_overtime_hours', label: 'Overtime', align: 'right', format: 'number' },
  { key: 'approved_sunday_hours', label: 'Sunday', align: 'right', format: 'number' },
  { key: 'approved_holiday_hours', label: 'Public holiday', align: 'right', format: 'number' },
  { key: 'approved_leave_hours', label: 'Approved leave', align: 'right', format: 'number' },
  { key: 'unpaid_hours', label: 'Unpaid', align: 'right', format: 'number' },
  { key: 'lock_versions', label: 'Lock versions' },
];

interface DayFact extends Record<string, unknown> {
  work_date: string; result_status: string | null; blocker_exception_id: string | null;
  pending_adjustment: boolean; summary_eligible: boolean;
  active_lock: boolean; latest_lock_version: string | number | null; latest_lock_action: string | null;
  locked_period_version: string | number | null; approved_regular_hrs: string | number | null;
  approved_overtime_hrs: string | number | null; approved_sunday_hrs: string | number | null;
  approved_holiday_hrs: string | number | null; leave_hrs: string | number | null;
  unpaid_hrs: string | number | null;
}

interface WorkerFacts extends Record<string, unknown> {
  staff_id: string; full_name: string; department: string | null; days: DayFact[];
}

export async function runPayrollReadiness(input: ReportInput): Promise<ReportRunResult> {
  if (input.scopedStaffIds?.length === 0) return empty();
  if (!input.dateFrom || !input.dateTo) return { ...empty(), notes: ['Date range is required.'] };
  const pb = makeParamBuilder();
  const from = pb.next(input.dateFrom);
  const to = pb.next(input.dateTo);
  const staffWhere: string[] = [];
  if (input.scopedStaffIds !== null) staffWhere.push(`s.id = ANY(${pb.next(input.scopedStaffIds)}::uuid[])`);
  if (input.departments.length > 0) staffWhere.push(`s.department = ANY(${pb.next(input.departments)}::text[])`);
  const rows = await sql.query<WorkerFacts>(`
    WITH staff_scope AS (
      SELECT s.id, s.first_name, s.last_name, s.department,
             s.is_active, s.join_date, s.end_date, s.account_status
      FROM staff s
      ${staffWhere.length > 0 ? `WHERE ${staffWhere.join(' AND ')}` : ''}
    ), workdays AS (
      SELECT day::date AS work_date FROM generate_series(${from}::date, ${to}::date, '1 day') day
      WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6
    ), expected AS (
      SELECT s.*, w.work_date FROM staff_scope s CROSS JOIN workdays w
      WHERE ${employmentEffectivePredicate('s', 'w.work_date')}
    ), joined AS (
      SELECT expected.*, ds.result_status, ds.locked_period_version,
        ds.approved_regular_hrs, ds.approved_overtime_hrs, ds.approved_sunday_hrs,
        ds.approved_holiday_hrs, ds.leave_hrs, ds.unpaid_hrs,
        (ds.result_status IN ('approved', 'locked') AND ds.approved_at IS NOT NULL
          AND (${approvedBucketInvariantSql('ds')})) AS summary_eligible,
        EXISTS (
          SELECT 1 FROM attendance_adjustments aa
          JOIN attendance_entries ae ON ae.id = aa.entry_id
          WHERE ae.staff_id = expected.id AND ae.work_date = expected.work_date
            AND aa.status = 'pending'
        ) AS pending_adjustment,
        blocker.exception_id AS blocker_exception_id,
        active_lock.week_start_date IS NOT NULL AS active_lock,
        lock_state.lock_version AS latest_lock_version, lock_state.action AS latest_lock_action
      FROM expected
      LEFT JOIN attendance_daily_summaries ds
        ON ds.staff_id = expected.id AND ds.work_date = expected.work_date
      LEFT JOIN LATERAL (
        SELECT de.id AS exception_id FROM attendance_day_exceptions de
        WHERE de.staff_id = expected.id AND de.work_date = expected.work_date
          AND de.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')
        ORDER BY de.created_at, de.id LIMIT 1
      ) blocker ON true
      LEFT JOIN attendance_weekly_locks active_lock
        ON active_lock.week_start_date = date_trunc('week', expected.work_date)::date
        AND active_lock.unlocked_at IS NULL
      LEFT JOIN LATERAL (
        SELECT history.lock_version, history.action FROM attendance_weekly_lock_history history
        WHERE history.week_start_date = date_trunc('week', expected.work_date)::date
        ORDER BY history.lock_version DESC, history.recorded_at DESC, history.id DESC LIMIT 1
      ) lock_state ON true
    )
    SELECT id::text AS staff_id,
      TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) AS full_name,
      department, JSONB_AGG(JSONB_BUILD_OBJECT(
        'work_date', TO_CHAR(work_date, 'YYYY-MM-DD'), 'result_status', result_status,
        'blocker_exception_id', blocker_exception_id, 'pending_adjustment', pending_adjustment,
        'summary_eligible', summary_eligible, 'active_lock', active_lock,
        'latest_lock_version', latest_lock_version, 'latest_lock_action', latest_lock_action,
        'locked_period_version', locked_period_version, 'approved_regular_hrs', approved_regular_hrs,
        'approved_overtime_hrs', approved_overtime_hrs, 'approved_sunday_hrs', approved_sunday_hrs,
        'approved_holiday_hrs', approved_holiday_hrs, 'leave_hrs', leave_hrs, 'unpaid_hrs', unpaid_hrs
      ) ORDER BY work_date) AS days
    FROM joined GROUP BY id, first_name, last_name, department
    ORDER BY full_name, id LIMIT ${pb.next(REPORT_ROW_CAP + 1)}`, pb.params);
  if (rows.length > REPORT_ROW_CAP) throw new ReportTooLargeError(rows.length);
  return {
    rows: rows.map(aggregateWorker), columns: COLUMNS,
    notes: ['Only approved results and active locked results matching the latest lock version contribute hours.'],
  };
}

function aggregateWorker(row: WorkerFacts): Record<string, unknown> {
  const approved = row.days.filter(isAuthoritative);
  const sum = (key: keyof Pick<DayFact, 'approved_regular_hrs' | 'approved_overtime_hrs' |
    'approved_sunday_hrs' | 'approved_holiday_hrs' | 'leave_hrs' | 'unpaid_hrs'>) =>
    approved.reduce((total, day) => total + Number(day[key] ?? 0), 0);
  const lockVersions = [...new Set(approved
    .filter((day) => day.result_status === 'locked')
    .map((day) => Number(day.locked_period_version)))]
    .sort((left, right) => left - right)
    .join(',');
  const blocked = row.days.length - approved.length;
  return {
    worker: row.full_name, department: row.department ?? '', expected_days: row.days.length,
    approved_days: approved.length, blocked_days: blocked,
    readiness_status: blocked === 0 ? 'ready' : 'blocked',
    approved_regular_hours: sum('approved_regular_hrs'),
    approved_overtime_hours: sum('approved_overtime_hrs'),
    approved_sunday_hours: sum('approved_sunday_hrs'),
    approved_holiday_hours: sum('approved_holiday_hrs'), approved_leave_hours: sum('leave_hrs'),
    unpaid_hours: sum('unpaid_hrs'), lock_versions: lockVersions,
  };
}

function isAuthoritative(day: DayFact): boolean {
  if (day.blocker_exception_id !== null || day.pending_adjustment || !day.summary_eligible) return false;
  if (day.result_status === 'approved') return true;
  return day.result_status === 'locked' && day.active_lock &&
    day.locked_period_version !== null && day.latest_lock_version !== null &&
    (day.latest_lock_action === 'lock' || day.latest_lock_action === 'relock') &&
    Number(day.locked_period_version) === Number(day.latest_lock_version);
}

function empty(): ReportRunResult { return { rows: [], columns: COLUMNS, notes: [] }; }
