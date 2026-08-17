import { query } from '@/lib/db-pool';
import { employmentEffectivePredicate } from '@/services/attendance/employmentUniverse';

export interface WorkerNotificationRow extends Record<string, unknown> {
  staff_id: string;
  work_date: string;
}

export interface CorrectionNotificationRow extends WorkerNotificationRow {
  exception_id: string;
  result_version: string | number;
  kind: 'missing_clock_out';
}

export interface ClockoutNotificationRow extends WorkerNotificationRow {
  entry_id: string;
}

export interface StaffUserRow extends Record<string, unknown> {
  id: string | null;
  is_active: boolean | null;
  staff_is_active: boolean | null;
  end_date: string | null;
}

export interface SupervisorLinkRow extends Record<string, unknown> {
  recipient_user_id: string;
  supervisor_staff_id: string | null;
}

export interface AdminRecipientRow extends Record<string, unknown> {
  recipient_user_id: string;
  role: 'admin' | 'super_admin';
}

export interface SupervisorDigestCounts {
  liveOpenSessions: number;
  sundayWork: number;
  overtime: number;
  unresolvedClassifications: number;
  outstandingCorrections: number;
}

export async function loadMorningCandidates(workDate: string): Promise<CorrectionNotificationRow[]> {
  return query<CorrectionNotificationRow>(`
    /* attendance-notifications:morning-candidates */
    SELECT de.id::text AS exception_id, de.staff_id,
           TO_CHAR(de.work_date, 'YYYY-MM-DD') AS work_date,
           de.result_version, de.kind
    FROM attendance_day_exceptions de
    JOIN attendance_entries ae
      ON ae.id = de.entry_id AND ae.staff_id = de.staff_id
    JOIN attendance_daily_summaries ds
      ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
    WHERE de.work_date <= $1::date
      AND de.status = 'awaiting_worker'
      AND de.kind = 'missing_clock_out'
      AND de.adjustment_id IS NULL
      AND de.resolved_at IS NULL
      AND de.entry_id IS NOT NULL
      AND ae.clock_out_at IS NULL
      AND ds.result_version = de.result_version
    ORDER BY de.work_date, de.created_at, de.id`, [workDate]);
}

export async function loadClockoutCandidates(workDate: string): Promise<ClockoutNotificationRow[]> {
  return query<ClockoutNotificationRow>(`
    /* attendance-notifications:clockout-candidates */
    SELECT ae.id::text AS entry_id, ae.staff_id,
           TO_CHAR(ae.work_date, 'YYYY-MM-DD') AS work_date
    FROM attendance_entries ae
    WHERE ae.work_date = $1::date
      AND ae.status = 'open'
      AND ae.clock_out_at IS NULL
    ORDER BY ae.clock_in_at, ae.id`, [workDate]);
}

export async function loadStaffUser(staffId: string): Promise<StaffUserRow[]> {
  return query<StaffUserRow>(`
    /* attendance-notifications:staff-user */
    SELECT u.id, u.is_active, s.is_active AS staff_is_active,
           s.end_date::text
    FROM staff s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = $1::uuid
    ORDER BY u.id`, [staffId]);
}

export async function loadSupervisorLinks(): Promise<SupervisorLinkRow[]> {
  return query<SupervisorLinkRow>(`
    /* attendance-notifications:supervisor-links */
    SELECT u.id AS recipient_user_id, s.id AS supervisor_staff_id
    FROM users u
    LEFT JOIN staff s ON s.user_id = u.id
      AND (s.is_active = true OR s.is_active IS NULL)
      AND s.end_date IS NULL
    WHERE u.is_active = true
      AND u.role IN ('manager', 'site_supervisor')
    ORDER BY u.id, s.id`);
}

export async function loadSupervisorMorningFlagCount(
  supervisorStaffId: string,
  workDate: string,
): Promise<number> {
  const rows = await query<{ total_count: string | number }>(`
    /* attendance-notifications:supervisor-morning-count */
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM staff WHERE reports_to = $1::uuid
      UNION ALL
      SELECT s.id, d.depth + 1 FROM staff s
      JOIN descendants d ON s.reports_to = d.id
      WHERE d.depth < 10
    ), viewer AS (
      SELECT id, department FROM staff WHERE id = $1::uuid
    ), viewer_has_reports AS (
      SELECT EXISTS (SELECT 1 FROM staff WHERE reports_to = $1::uuid) AS yes
    ), supervised_staff AS (
      SELECT id FROM viewer
      UNION SELECT id FROM descendants
      UNION SELECT s.id FROM staff s, viewer v, viewer_has_reports vhr
        WHERE vhr.yes AND v.department IS NOT NULL AND s.department IS NOT NULL
          AND s.department = v.department
    ), effective_policy AS (
      SELECT weekday_start, saturday_start
      FROM attendance_schedule_policies
      WHERE active_from <= $2::date
        AND (active_to IS NULL OR active_to >= $2::date)
      ORDER BY active_from DESC, id DESC
      LIMIT 1
    ), expected AS (
      SELECT employee.id,
        CASE WHEN EXTRACT(ISODOW FROM $2::date) = 6
          THEN policy.saturday_start ELSE policy.weekday_start END AS shift_start,
        first_entry.first_clock_in
      FROM staff employee
      CROSS JOIN effective_policy policy
      LEFT JOIN LATERAL (
        SELECT MIN(ae.clock_in_at AT TIME ZONE 'Africa/Johannesburg') AS first_clock_in
        FROM attendance_entries ae
        WHERE ae.staff_id = employee.id AND ae.work_date = $2::date
      ) first_entry ON true
      WHERE employee.id IN (SELECT id FROM supervised_staff)
        AND EXTRACT(ISODOW FROM $2::date) BETWEEN 1 AND 6
        AND ${employmentEffectivePredicate('employee', '$2::date')}
        AND NOT EXISTS (
          SELECT 1 FROM public_holidays holiday WHERE holiday.date = $2::date
        )
    )
    SELECT COUNT(*)::int AS total_count
    FROM expected
    WHERE expected.first_clock_in IS NULL
      OR expected.first_clock_in > ($2::date + expected.shift_start)`, [supervisorStaffId, workDate]);
  const count = Number(rows[0]?.total_count ?? 0);
  if (!Number.isInteger(count) || count < 0) throw new Error('Invalid supervisor attendance action count');
  return count;
}

export async function loadSupervisorDigestCounts(
  supervisorStaffId: string,
  workDate: string,
): Promise<SupervisorDigestCounts> {
  const rows = await query<Record<string, string | number>>(`
    /* attendance-notifications:supervisor-digest-counts */
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS depth FROM staff WHERE reports_to = $1::uuid
      UNION ALL
      SELECT s.id, d.depth + 1 FROM staff s JOIN descendants d ON s.reports_to = d.id
      WHERE d.depth < 10
    ), viewer AS (
      SELECT id, department FROM staff WHERE id = $1::uuid
    ), viewer_has_reports AS (
      SELECT EXISTS (SELECT 1 FROM staff WHERE reports_to = $1::uuid) AS yes
    ), supervised_staff AS (
      SELECT id FROM viewer UNION SELECT id FROM descendants
      UNION SELECT s.id FROM staff s, viewer v, viewer_has_reports vhr
        WHERE vhr.yes AND v.department IS NOT NULL AND s.department = v.department
    )
    SELECT
      (SELECT COUNT(*) FROM attendance_entries ae
        WHERE ae.staff_id IN (SELECT id FROM supervised_staff)
          AND ae.work_date <= $2::date AND ae.status = 'open' AND ae.clock_out_at IS NULL) AS live_open_sessions,
      (SELECT COUNT(*) FROM attendance_daily_summaries ds
        WHERE ds.staff_id IN (SELECT id FROM supervised_staff) AND ds.work_date <= $2::date
          AND COALESCE(ds.proposed_sunday_hrs, 0) > 0
          AND ds.result_status NOT IN ('approved', 'locked')) AS sunday_work,
      (SELECT COUNT(*) FROM attendance_daily_summaries ds
        WHERE ds.staff_id IN (SELECT id FROM supervised_staff) AND ds.work_date <= $2::date
          AND COALESCE(ds.proposed_overtime_hrs, 0) > 0
          AND ds.result_status NOT IN ('approved', 'locked')) AS overtime,
      (SELECT COUNT(*) FROM attendance_daily_summaries ds
        WHERE ds.staff_id IN (SELECT id FROM supervised_staff) AND ds.work_date <= $2::date
          AND ds.attendance_classification IS NOT NULL
          AND ds.result_status NOT IN ('approved', 'locked')) AS unresolved_classifications,
      (SELECT COUNT(*) FROM attendance_adjustments aa
        JOIN attendance_entries ae ON ae.id = aa.entry_id
        WHERE ae.staff_id IN (SELECT id FROM supervised_staff)
          AND ae.work_date <= $2::date AND aa.status = 'pending') AS outstanding_corrections`,
  [supervisorStaffId, workDate]);
  const row = rows[0] ?? {};
  const counts = {
    liveOpenSessions: Number(row.live_open_sessions ?? 0),
    sundayWork: Number(row.sunday_work ?? 0),
    overtime: Number(row.overtime ?? 0),
    unresolvedClassifications: Number(row.unresolved_classifications ?? 0),
    outstandingCorrections: Number(row.outstanding_corrections ?? 0),
  };
  if (Object.values(counts).some((count) => !Number.isInteger(count) || count < 0)) {
    throw new Error('Invalid supervisor attendance digest counts');
  }
  return counts;
}

export async function loadAdminRecipients(): Promise<AdminRecipientRow[]> {
  return query<AdminRecipientRow>(`
    /* attendance-notifications:admin-recipients */
    SELECT u.id AS recipient_user_id, u.role
    FROM users u
    WHERE u.is_active = true
      AND u.role IN ('admin', 'super_admin')
    ORDER BY u.id`);
}

export async function claimDispatch(args: {
  deliveryKey: string;
  phase: string;
  sourceKey: string;
  recipientUserId: string;
}): Promise<boolean> {
  const rows = await query<{ delivery_key: string }>(`
    INSERT INTO attendance_notification_dispatches (
      delivery_key, phase, source_key, recipient_user_id, status
    ) VALUES ($1, $2, $3, $4::uuid, 'claimed')
    -- A 'failed' dispatch is reclaimable; 'accepted' and 'claimed' are not.
    -- delivery_key is the primary key, so a bare DO NOTHING made 'failed' just
    -- as terminal as 'accepted' — a delivery that failed could never be
    -- retried, only re-labelled (#2506). The WHERE scopes the update to failed
    -- rows, so a genuinely delivered notification is still never re-sent and a
    -- run in flight is not stolen.
    ON CONFLICT (delivery_key) DO UPDATE
      SET status = 'claimed', failure_message = NULL, updated_at = NOW()
      WHERE attendance_notification_dispatches.status = 'failed'
    RETURNING delivery_key`, [args.deliveryKey, args.phase, args.sourceKey, args.recipientUserId]);
  return rows.length === 1;
}

export async function finishDispatch(
  deliveryKey: string,
  status: 'accepted' | 'failed',
  failureMessage: string | null,
): Promise<void> {
  const rows = await query<{ delivery_key: string }>(`
    UPDATE attendance_notification_dispatches
    SET status = $2, failure_message = $3, updated_at = NOW()
    WHERE delivery_key = $1 AND status = 'claimed'
    RETURNING delivery_key`, [deliveryKey, status, failureMessage]);
  if (rows.length !== 1) throw new Error('Attendance notification dispatch read-back failed');
}
