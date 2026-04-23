/**
 * SQL helpers for attendance weekly locks.
 */

import { sql } from '@/lib/db-pool';

export interface WeeklyLockRow extends Record<string, unknown> {
  week_start_date: string;
  locked_at: string;
  locked_by: string;
  lock_reason: string | null;
  unlocked_at: string | null;
  unlocked_by: string | null;
  unlock_reason: string | null;
}

export async function lookupActiveLock(weekStartDate: string): Promise<WeeklyLockRow | null> {
  const rows = await sql<WeeklyLockRow>`
    SELECT week_start_date::text AS week_start_date,
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
    SELECT week_start_date::text AS week_start_date,
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
    INSERT INTO attendance_weekly_locks (week_start_date, locked_by, lock_reason)
    VALUES (${args.weekStartDate}::date, ${args.lockedBy}, ${args.lockReason})
    ON CONFLICT (week_start_date) DO UPDATE
      SET locked_at     = NOW(),
          locked_by     = EXCLUDED.locked_by,
          lock_reason   = EXCLUDED.lock_reason,
          unlocked_at   = NULL,
          unlocked_by   = NULL,
          unlock_reason = NULL
    RETURNING week_start_date::text AS week_start_date,
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
    RETURNING week_start_date::text AS week_start_date,
              locked_at::text, locked_by, lock_reason,
              unlocked_at::text, unlocked_by, unlock_reason
  `;
  return rows[0] ?? null;
}

export async function listLocks(limit: number): Promise<WeeklyLockRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
  return sql<WeeklyLockRow>`
    SELECT week_start_date::text AS week_start_date,
           locked_at::text, locked_by, lock_reason,
           unlocked_at::text, unlocked_by, unlock_reason
    FROM attendance_weekly_locks
    ORDER BY week_start_date DESC
    LIMIT ${safeLimit}
  `;
}

// Canonical isoWeekMonday lives in src/services/attendance/isoWeek.ts.
// Re-exported here so existing importers in this directory keep working;
// consolidation kills the drift risk flagged in the PR #1397 review.
export { isoWeekMonday } from '@/services/attendance/isoWeek';
