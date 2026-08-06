import {
  employmentEffectivePredicate,
  expectedAttendanceDayPredicate,
} from '@/services/attendance/employmentUniverse';
import { approvedBucketInvariantSql } from '@/services/attendance/policy/approvedBuckets';

function snapshotEligible(alias: string): string { return `
  ${alias}.approved_at IS NOT NULL
  AND ${approvedBucketInvariantSql(alias)}`; }

export function metricsSql(): string { return `
  WITH bounds AS (SELECT $1::date AS from_date, $2::date AS to_date),
  workdays AS (SELECT day::date AS work_date FROM bounds, generate_series(from_date, to_date, '1 day') day WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6),
  expected AS (SELECT s.id AS staff_id, w.work_date FROM staff s CROSS JOIN workdays w WHERE ${expectedAttendanceDayPredicate('s', 'w.work_date')}),
  latest_run AS (SELECT status, started_at, finished_at, failed_day_keys FROM attendance_reconciliation_runs, bounds WHERE scanned_from <= from_date AND scanned_to >= to_date ORDER BY started_at DESC LIMIT 1),
  last_success AS (SELECT finished_at FROM attendance_reconciliation_runs, bounds WHERE status = 'succeeded' AND scanned_from <= from_date AND scanned_to >= to_date ORDER BY finished_at DESC LIMIT 1),
  summary_change AS (SELECT MAX(ds.computed_at) AS changed_at FROM attendance_daily_summaries ds, bounds WHERE ds.work_date BETWEEN from_date AND to_date),
  exception_change AS (SELECT MAX(de.updated_at) AS changed_at FROM attendance_day_exceptions de, bounds WHERE de.work_date BETWEEN from_date AND to_date),
  entry_change AS (SELECT MAX(ae.updated_at) AS changed_at FROM attendance_entries ae, bounds WHERE ae.work_date BETWEEN from_date AND to_date),
  adjustment_change AS (SELECT MAX(aa.updated_at) AS changed_at FROM attendance_adjustments aa JOIN attendance_entries aae ON aae.id = aa.entry_id CROSS JOIN bounds WHERE aae.work_date BETWEEN from_date AND to_date),
  latest_change AS (SELECT GREATEST(COALESCE(sc.changed_at, '-infinity'::timestamptz), COALESCE(ec.changed_at, '-infinity'::timestamptz), COALESCE(aec.changed_at, '-infinity'::timestamptz), COALESCE(ac.changed_at, '-infinity'::timestamptz)) AS changed_at FROM summary_change sc CROSS JOIN exception_change ec CROSS JOIN entry_change aec CROSS JOIN adjustment_change ac)
  SELECT (SELECT COUNT(DISTINCT staff_id) FROM expected)::int AS active_staff_count, COUNT(*)::int AS expected_day_count,
    COUNT(ds.staff_id) FILTER (WHERE ds.result_status = 'approved' AND ${snapshotEligible('ds')})::int AS approved_day_count,
    COALESCE((SELECT SUM(ds2.proposed_overtime_hrs) FROM attendance_daily_summaries ds2
      JOIN staff s2 ON s2.id = ds2.staff_id CROSS JOIN bounds
      WHERE ds2.work_date BETWEEN from_date AND to_date
        AND ${employmentEffectivePredicate('s2', 'ds2.work_date')}
        AND ds2.result_status NOT IN ('approved', 'locked')), 0) AS unapproved_overtime_hours,
    COALESCE((SELECT SUM(ds2.proposed_sunday_hrs) FROM attendance_daily_summaries ds2
      JOIN staff s2 ON s2.id = ds2.staff_id CROSS JOIN bounds
      WHERE ds2.work_date BETWEEN from_date AND to_date
        AND ${employmentEffectivePredicate('s2', 'ds2.work_date')}
        AND ds2.result_status NOT IN ('approved', 'locked')), 0) AS unapproved_sunday_hours,
    (SELECT finished_at::text FROM last_success) AS reconciliation_last_succeeded_at,
    COALESCE((SELECT status = 'succeeded' AND jsonb_array_length(failed_day_keys) = 0 AND finished_at >= changed_at FROM latest_run CROSS JOIN latest_change), false) AS reconciliation_fresh,
    EXISTS (SELECT 1 FROM attendance_weekly_locks, bounds WHERE week_start_date = from_date AND unlocked_at IS NULL) AS active_lock
  FROM expected LEFT JOIN attendance_daily_summaries ds ON ds.staff_id = expected.staff_id AND ds.work_date = expected.work_date`; }

export function blockersSql(): string { return `
  WITH workdays AS (SELECT day::date AS work_date FROM generate_series($1::date, $2::date, '1 day') day WHERE EXTRACT(ISODOW FROM day) BETWEEN 1 AND 6),
  expected AS (SELECT s.id AS staff_id, w.work_date FROM staff s CROSS JOIN workdays w WHERE ${expectedAttendanceDayPredicate('s', 'w.work_date')}),
  unresolved AS (SELECT de.staff_id, TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date, de.status AS blocker_kind, de.id::text AS exception_id, de.kind AS exception_kind, de.status AS exception_status
    FROM attendance_day_exceptions de JOIN staff sde ON sde.id = de.staff_id
    WHERE de.work_date BETWEEN $1::date AND $2::date
      AND ${employmentEffectivePredicate('sde', 'de.work_date')}
      AND de.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')),
  pending_adjustments AS (SELECT ae.staff_id, TO_CHAR(ae.work_date, 'YYYY-MM-DD') AS work_date, 'pending_adjustment'::text AS blocker_kind, de.id::text AS exception_id, de.kind AS exception_kind, aa.status AS exception_status
    FROM attendance_adjustments aa JOIN attendance_entries ae ON ae.id = aa.entry_id
    JOIN staff saa ON saa.id = ae.staff_id
    LEFT JOIN attendance_day_exceptions de ON de.adjustment_id = aa.id
    WHERE ae.work_date BETWEEN $1::date AND $2::date
      AND ${employmentEffectivePredicate('saa', 'ae.work_date')} AND aa.status = 'pending'),
  incomplete_identity AS (SELECT ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date,
      'incomplete_payroll_snapshot'::text AS blocker_kind, NULL::text AS exception_id,
      NULL::text AS exception_kind, ds.result_status::text AS exception_status
    FROM attendance_daily_summaries ds JOIN staff sident ON sident.id = ds.staff_id
    WHERE ds.work_date BETWEEN $1::date AND $2::date AND ds.result_status = 'approved'
      AND ${employmentEffectivePredicate('sident', 'ds.work_date')}
      AND (ds.result_version IS NULL OR ds.result_version < 1
        OR NULLIF(TRIM(sident.employee_id), '') IS NULL
        OR NULLIF(TRIM(COALESCE(sident.first_name, '') || ' ' || COALESCE(sident.last_name, '')), '') IS NULL))
  SELECT * FROM unresolved UNION ALL
  SELECT * FROM pending_adjustments UNION ALL
  SELECT * FROM incomplete_identity UNION ALL
  SELECT expected.staff_id, TO_CHAR(expected.work_date, 'YYYY-MM-DD'), 'missing_daily_result', NULL, NULL, 'missing'
    FROM expected LEFT JOIN attendance_daily_summaries ds ON ds.staff_id = expected.staff_id AND ds.work_date = expected.work_date WHERE ds.staff_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM unresolved u WHERE u.staff_id = expected.staff_id AND u.work_date = TO_CHAR(expected.work_date, 'YYYY-MM-DD'))
  UNION ALL SELECT ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD'), 'orphan_locked_result', NULL, NULL, ds.result_status
    FROM attendance_daily_summaries ds WHERE ds.work_date BETWEEN $1::date AND $2::date AND ds.result_status = 'locked'
      AND NOT EXISTS (SELECT 1 FROM attendance_weekly_locks wl WHERE wl.week_start_date = date_trunc('week', ds.work_date)::date AND wl.unlocked_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM unresolved u WHERE u.staff_id = ds.staff_id AND u.work_date = TO_CHAR(ds.work_date, 'YYYY-MM-DD'))
  UNION ALL SELECT ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD'), 'unapproved_' || ds.result_status, NULL, NULL, ds.result_status
    FROM attendance_daily_summaries ds JOIN staff sds ON sds.id = ds.staff_id
    WHERE ds.work_date BETWEEN $1::date AND $2::date
      AND ${employmentEffectivePredicate('sds', 'ds.work_date')}
      AND ds.result_status NOT IN ('approved', 'locked')
      AND NOT EXISTS (SELECT 1 FROM unresolved u WHERE u.staff_id = ds.staff_id AND u.work_date = TO_CHAR(ds.work_date, 'YYYY-MM-DD'))
  ORDER BY work_date, staff_id, blocker_kind`; }
