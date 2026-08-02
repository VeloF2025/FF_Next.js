import type { TxnClient } from '@/lib/db-pool';
import { acquireAttendanceWeekLock } from '@/modules/attendance/corrections/lockQueries';
import { isoWeekMonday } from '@/services/attendance/isoWeek';

interface PeriodLockRow extends Record<string, unknown> { active_period_lock: boolean }

export class AttendanceProjectionLockedError extends Error {
  readonly code = 'period_locked';
  constructor(message = 'The payroll week is locked') {
    super(message);
    this.name = 'AttendanceProjectionLockedError';
  }
}

export async function guardProjectionDay(
  tx: TxnClient, staffId: string, workDate: string,
): Promise<void> {
  const week = isoWeekMonday(workDate);
  await acquireAttendanceWeekLock(tx, week);
  await tx.query(`
    SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))`,
  [staffId, workDate]);
  const period = await tx.queryOne<PeriodLockRow>(`
    SELECT EXISTS (
      SELECT 1 FROM attendance_weekly_locks
      WHERE week_start_date = $1::date AND unlocked_at IS NULL
    ) AS active_period_lock`, [week]);
  if (period?.active_period_lock === true) throw new AttendanceProjectionLockedError();
}

export function assertDailyProjectionUnlocked(resultStatus: string | undefined): void {
  if (resultStatus === 'locked') {
    throw new AttendanceProjectionLockedError('The daily attendance result is locked');
  }
}
