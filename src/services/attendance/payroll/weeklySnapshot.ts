import { transaction, type TxnClient } from '@/lib/db-pool';
import { acquireAttendanceWeekLock } from '@/modules/attendance/corrections/lockQueries';

import type {
  ActivePayrollLockRow, LockedPayrollDayRow, PayrollLockHistoryRow,
} from './query';
import {
  readPayrollSnapshot, validateActivePayrollLock, validateLockedRows,
} from './snapshot';
import { AttendancePayrollExportError } from './types';

interface WeeklySnapshotDependencies {
  readActiveLock(week: string): Promise<ActivePayrollLockRow | null>;
  readLatestHistory(week: string): Promise<PayrollLockHistoryRow | null>;
  readLockedDays(week: string, weekEnd: string): Promise<LockedPayrollDayRow[]>;
}

export interface WeeklyPayrollSnapshot {
  lock: { version: number; lockedAt: string; lockedBy: string; reason: string | null };
  totals: {
    regularHrs: number; overtimeHrs: number; sundayHrs: number;
    holidayHrs: number; leaveHrs: number; unpaidHrs: number;
  };
}

export function createWeeklyPayrollSnapshotReader(deps: WeeklySnapshotDependencies) {
  return async function loadWeeklyPayrollSnapshot(
    week: string,
    weekEnd: string,
  ): Promise<WeeklyPayrollSnapshot | null> {
    const active = await deps.readActiveLock(week);
    if (!active) {
      const orphanRows = await deps.readLockedDays(week, weekEnd);
      if (orphanRows.length > 0) {
        throw new AttendancePayrollExportError(
          'export_version_conflict', 'Locked attendance rows have no active weekly lock',
        );
      }
      return null;
    }
    const history = await deps.readLatestHistory(week);
    const version = validateActivePayrollLock(active, history);
    const liveRows = await deps.readLockedDays(week, weekEnd);
    const frozenRows = readPayrollSnapshot(history!.result_snapshot, version);
    validateLockedRows(frozenRows, liveRows, version);
    const totals = {
      regularHrs: 0, overtimeHrs: 0, sundayHrs: 0,
      holidayHrs: 0, leaveHrs: 0, unpaidHrs: 0,
    };
    for (const row of frozenRows) {
      totals.regularHrs += Number(row.approved_regular_hrs);
      totals.overtimeHrs += Number(row.approved_overtime_hrs);
      totals.sundayHrs += Number(row.approved_sunday_hrs);
      totals.holidayHrs += Number(row.approved_holiday_hrs);
      totals.leaveHrs += Number(row.leave_hrs);
      totals.unpaidHrs += Number(row.unpaid_hrs);
    }
    return {
      lock: {
        version, lockedAt: active.locked_at, lockedBy: active.locked_by,
        reason: active.lock_reason,
      },
      totals,
    };
  };
}

function transactionReader(tx: TxnClient): WeeklySnapshotDependencies {
  return {
    readActiveLock: (week) => tx.queryOne<ActivePayrollLockRow>(`/* payroll:weekly-active-lock */
    SELECT TO_CHAR(week_start_date, 'YYYY-MM-DD') AS week_start_date,
      locked_at::text, locked_by, lock_reason, unlocked_at::text
    FROM attendance_weekly_locks
    WHERE week_start_date = $1::date AND unlocked_at IS NULL`, [week]),
    readLatestHistory: (week) => tx.queryOne<PayrollLockHistoryRow>(`/* payroll:weekly-lock-history */
    SELECT lock_version, action, actor_user_id, reason, recorded_at::text, result_snapshot
    FROM attendance_weekly_lock_history WHERE week_start_date = $1::date
    ORDER BY lock_version DESC, recorded_at DESC, id DESC LIMIT 1`, [week]),
    readLockedDays: (week, weekEnd) => tx.query<LockedPayrollDayRow>(`/* payroll:weekly-locked-days */
    SELECT ds.staff_id, TO_CHAR(ds.work_date, 'YYYY-MM-DD') AS work_date, ds.result_status,
      ds.locked_period_version, ds.result_version, ds.approved_regular_hrs,
      ds.approved_overtime_hrs, ds.approved_sunday_hrs, ds.approved_holiday_hrs,
      ds.leave_hrs, ds.unpaid_hrs, ds.attendance_classification
    FROM attendance_daily_summaries ds
    WHERE ds.work_date BETWEEN $1::date AND $2::date AND ds.result_status = 'locked'
    ORDER BY ds.staff_id, ds.work_date`, [week, weekEnd]),
  };
}

export async function loadWeeklyPayrollSnapshot(
  week: string,
  weekEnd: string,
): Promise<WeeklyPayrollSnapshot | null> {
  return transaction(async (tx) => {
    await acquireAttendanceWeekLock(tx, week);
    return createWeeklyPayrollSnapshotReader(transactionReader(tx))(week, weekEnd);
  });
}
