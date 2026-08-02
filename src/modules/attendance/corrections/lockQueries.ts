/**
 * SQL helpers for attendance weekly locks.
 */

import { sql, type TxnClient } from '@/lib/db-pool';

export const ATTENDANCE_WEEK_LOCK_NAMESPACE = 'attendance-week-lock';
export const ATTENDANCE_STAFF_GATE_NAMESPACE = 'attendance-staff-gate';

export async function acquireAttendanceStaffGateLock(
  tx: TxnClient,
  staffId: string,
): Promise<void> {
  const rows = await tx.query(`
    SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text)) AS acquired`,
  [ATTENDANCE_STAFF_GATE_NAMESPACE, staffId]);
  if (rows.length !== 1) throw new Error('Attendance staff gate advisory lock was not acquired');
}

export async function acquireAttendanceWeekLock(
  tx: TxnClient,
  weekStartDate: string,
): Promise<void> {
  const rows = await tx.query(`
    SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text)) AS acquired`,
  [ATTENDANCE_WEEK_LOCK_NAMESPACE, weekStartDate]);
  if (rows.length !== 1) throw new Error('Attendance week advisory lock was not acquired');
}

export interface WeeklyLockRow extends Record<string, unknown> {
  week_start_date: string;
  locked_at: string;
  locked_by: string;
  lock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
}

export interface WeeklyLockListRow extends WeeklyLockRow {
  lock_version: string | number | null;
  latest_action: 'lock' | 'unlock' | 'relock' | null;
  latest_actor_user_id: string | null;
  latest_reason: string | null;
  latest_recorded_at: string | null;
}

export async function lookupActiveLock(weekStartDate: string): Promise<WeeklyLockRow | null> {
  const rows = await sql<WeeklyLockRow>`
    SELECT TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
           locked_at::text, locked_by, lock_reason,
           unlocked_at::text, unlocked_by, unlock_reason
    FROM attendance_weekly_locks
    WHERE week_start_date = ${weekStartDate}::date
      AND unlocked_at IS NULL
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function lookupAnyLock(weekStartDate: string): Promise<WeeklyLockRow | null> {
  const rows = await sql<WeeklyLockRow>`
    SELECT TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
           locked_at::text, locked_by, lock_reason,
           unlocked_at::text, unlocked_by, unlock_reason
    FROM attendance_weekly_locks
    WHERE week_start_date = ${weekStartDate}::date
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * Upsert lock. If a row exists (may be unlocked), re-lock it and clear the
 * previous unlock audit. Fresh lock reason is always captured.
 */
export async function upsertWeeklyLock(args: {
  weekStartDate: string;
  lockedBy: string;
  lockReason: string | null;
}): Promise<WeeklyLockRow> {
  const rows = await sql<WeeklyLockRow>`
    WITH week_guard AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
        hashtext(${ATTENDANCE_WEEK_LOCK_NAMESPACE}::text),
        hashtext(${args.weekStartDate}::text)
      )
    )
    INSERT INTO attendance_weekly_locks (week_start_date, locked_by, lock_reason)
    SELECT ${args.weekStartDate}::date, ${args.lockedBy}, ${args.lockReason}
    FROM week_guard
    ON CONFLICT (week_start_date) DO UPDATE
      SET locked_at     = NOW(),
          locked_by     = EXCLUDED.locked_by,
          lock_reason   = EXCLUDED.lock_reason,
          unlocked_at   = NULL,
          unlocked_by   = NULL,
          unlock_reason = NULL
    RETURNING TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
              locked_at::text, locked_by, lock_reason,
              unlocked_at::text, unlocked_by, unlock_reason
  `;
  const row = rows[0];
  if (!row) throw new Error('upsertWeeklyLock returned no row');
  return row;
}

export async function unlockWeek(args: {
  weekStartDate: string;
  unlockedBy: string;
  unlockReason: string;
}): Promise<WeeklyLockRow | null> {
  const rows = await sql<WeeklyLockRow>`
    UPDATE attendance_weekly_locks
    SET unlocked_at   = NOW(),
        unlocked_by   = ${args.unlockedBy},
        unlock_reason = ${args.unlockReason}
    WHERE week_start_date = ${args.weekStartDate}::date
      AND unlocked_at IS NULL
    RETURNING TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
              locked_at::text, locked_by, lock_reason,
              unlocked_at::text, unlocked_by, unlock_reason
  `;
  return rows[0] ?? null;
}

export async function listLocks(limit: number): Promise<WeeklyLockListRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  return sql<WeeklyLockListRow>`
    SELECT TO_CHAR(wl.week_start_date, 'YYYY-MM-DD') AS week_start_date,
           wl.locked_at::text, wl.locked_by, wl.lock_reason,
           wl.unlocked_at::text, wl.unlocked_by, wl.unlock_reason,
           history.lock_version, history.action AS latest_action,
           history.actor_user_id AS latest_actor_user_id,
           history.reason AS latest_reason,
           history.recorded_at AS latest_recorded_at
    FROM attendance_weekly_locks wl
    LEFT JOIN LATERAL (
      SELECT lock_version, action, actor_user_id, reason, recorded_at::text
      FROM attendance_weekly_lock_history
      WHERE week_start_date = wl.week_start_date
      ORDER BY lock_version DESC, recorded_at DESC
      LIMIT 1
    ) history ON true
    ORDER BY wl.week_start_date DESC
    LIMIT ${safeLimit}
  `;
}

export async function readWeeklyLock(weekStartDate: string): Promise<WeeklyLockListRow | null> {
  const rows = await sql<WeeklyLockListRow>`
    SELECT TO_CHAR(wl.week_start_date, 'YYYY-MM-DD') AS week_start_date,
           wl.locked_at::text, wl.locked_by, wl.lock_reason,
           wl.unlocked_at::text, wl.unlocked_by, wl.unlock_reason,
           history.lock_version, history.action AS latest_action,
           history.actor_user_id AS latest_actor_user_id,
           history.reason AS latest_reason,
           history.recorded_at AS latest_recorded_at
    FROM attendance_weekly_locks wl
    LEFT JOIN LATERAL (
      SELECT lock_version, action, actor_user_id, reason, recorded_at::text
      FROM attendance_weekly_lock_history
      WHERE week_start_date = wl.week_start_date
      ORDER BY lock_version DESC, recorded_at DESC
      LIMIT 1
    ) history ON true
    WHERE wl.week_start_date = ${weekStartDate}::date
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// Canonical isoWeekMonday lives in src/services/attendance/isoWeek.ts.
// Re-exported here so existing importers in this directory keep working;
// consolidation kills the drift risk flagged in the PR #1397 review.
export { isoWeekMonday } from '@/services/attendance/isoWeek';
