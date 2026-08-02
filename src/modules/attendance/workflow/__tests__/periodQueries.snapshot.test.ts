import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: vi.fn(), transaction: mocks.transaction }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: vi.fn(async () => true) }));

import { lockReadyWeek } from '../periodQueries';
import { buildPayrollLockSnapshot } from '../payrollLockSnapshot';
import { rowsForUpdate, weekDays } from './helpers/periodDayState';

const WEEK = '2026-08-03';
const LOCKED_AT = '2026-08-10T02:00:00Z';

beforeEach(() => vi.clearAllMocks());

describe('immutable payroll lock snapshot', () => {
  it('rejects contradictory approved categories before any week can be locked', () => {
    const source = rowsForUpdate(weekDays(WEEK), WEEK, '2026-08-08', 'approved');
    Object.assign(source[0]!, { approved_regular_hrs: 8, approved_sunday_hrs: 5 });

    expect(() => buildPayrollLockSnapshot(source as never, 1))
      .toThrow('Approved attendance buckets contradict the attendance classification');
  });

  it('freezes every payroll field, post-transition versions and the exact active timestamp', async () => {
    const tx = snapshotTxn();
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await lockReadyWeek({ weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved payroll snapshot' });

    const history = tx.queryOne.mock.calls.find((call) =>
      /INSERT INTO attendance_weekly_lock_history/i.test(String(call[0])));
    const snapshot = JSON.parse(String(history?.[1]?.[5]));
    expect(snapshot.payrollSnapshot).toMatchObject({ version: 1 });
    expect(snapshot.payrollSnapshot.rows[0]).toEqual(expect.objectContaining({
      staff_id: 'staff-1', employee_id: 'EMP001', full_name: 'Alice Example',
      work_date: '2026-08-03', approved_regular_hrs: '8.00', approved_overtime_hrs: '0.00',
      approved_sunday_hrs: '0.00', approved_holiday_hrs: '0.00', leave_hrs: '0.00',
      unpaid_hrs: '0.00', attendance_classification: null, project_id: 'project-1',
      site_id: 'site-1', result_version: 2, locked_period_version: 1,
    }));
    expect(history?.[1]?.[6]).toBe(LOCKED_AT);
    expect(snapshot.payrollSnapshot.rows.map((row: { work_date: string }) => row.work_date)).toEqual([
      '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08',
    ]);
    const sourceSql = String(tx.query.mock.calls.find((call) =>
      /attendance:payroll-lock-snapshot/i.test(String(call[0])))?.[0]);
    expect(sourceSql).toMatch(/FOR UPDATE OF ds, s/i);
    expect(sourceSql).toMatch(/FOR SHARE OF e/i);
    expect(sourceSql).toMatch(/FOR SHARE OF va/i);
    expect(sourceSql).toMatch(/FOR SHARE OF fvpa/i);
    expect(sourceSql).toMatch(/generate_series\(\$1::date,\s*\$2::date/i);
    expect(sourceSql).toContain('s.join_date::date <= w.work_date');
    expect(sourceSql).toContain('s.end_date::date >= w.work_date');
    expect(sourceSql).toContain("LOWER(s.account_status) <> 'pending'");
  });

  it('does not let a Sunday result conceal a missing expected worker-day', async () => {
    const tx = snapshotTxn(false, null, true);
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved payroll snapshot',
    })).rejects.toThrow('changed during lock preflight');
    expect(tx.queryOne.mock.calls.some((call) =>
      /INSERT INTO attendance_weekly_locks/i.test(String(call[0])))).toBe(false);
  });

  it('rejects an oversized snapshot before active lock writes', async () => {
    const tx = snapshotTxn(true);
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved payroll snapshot',
    })).rejects.toThrow('JSON payload exceeds 1048576 bytes');
    expect(tx.queryOne.mock.calls.some((call) =>
      /INSERT INTO attendance_weekly_locks/i.test(String(call[0])))).toBe(false);
  });

  it('freezes re-lock rows against the next lock and result versions', async () => {
    const tx = snapshotTxn(false, 1);
    mocks.transaction.mockImplementation(async (work) => work(tx));
    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved payroll snapshot',
    })).resolves.toMatchObject({ version: 2, active: true });
    const history = tx.queryOne.mock.calls.find((call) =>
      /INSERT INTO attendance_weekly_lock_history/i.test(String(call[0])));
    const snapshot = JSON.parse(String(history?.[1]?.[5]));
    expect(history?.[1]?.[2]).toBe('relock');
    expect(snapshot.payrollSnapshot.rows[0]).toMatchObject({
      result_version: 2, locked_period_version: 2,
    });
  });
});

function snapshotTxn(
  oversized = false, priorVersion: number | null = null, extraRow = false,
) {
  const days = weekDays(WEEK);
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
    if (/active_staff_count/i.test(text)) return [{ active_staff_count: 1,
      expected_day_count: 6, approved_day_count: 6, unapproved_overtime_hours: 0,
      unapproved_sunday_hours: 0, reconciliation_last_succeeded_at: LOCKED_AT,
      reconciliation_fresh: true, active_lock: false }];
    if (/blocker_kind/i.test(text)) return [];
    if (/attendance:payroll-lock-snapshot/i.test(text)) {
      const rows = rowsForUpdate(days, String(params[0]), String(params[1]), 'approved');
      if (extraRow) {
        rows.pop();
        rows.push({
          ...rows[0]!, staff_id: 'staff-sunday', work_date: '2026-08-09', expected_day: false,
        });
      }
      return oversized ? rows.map((row, index) => index ? row
        : { ...row, full_name: 'x'.repeat(1_048_576) }) : rows;
    }
    return [];
  });
  const queryOne = vi.fn(async (text: string) => {
    if (/FROM users/i.test(text)) return { role: 'admin' };
    if (/FROM attendance_weekly_locks/i.test(text) && /FOR UPDATE/i.test(text)) {
      return priorVersion ? lockRow(true) : null;
    }
    if (/FROM attendance_weekly_lock_history/i.test(text)) {
      return priorVersion ? { lock_version: priorVersion, result_snapshot: {} } : null;
    }
    if (/INSERT INTO attendance_weekly_locks/i.test(text)) return lockRow();
    if (/INSERT INTO attendance_weekly_lock_history/i.test(text)) return { lock_version: 1 };
    if (/UPDATE attendance_daily_summaries/i.test(text)) return { affected_count: 6 };
    if (/INSERT INTO attendance_decision_events/i.test(text)) return { id: 'event-1' };
    if (/SELECT .*FROM attendance_weekly_locks/i.test(text)) return lockRow();
    return null;
  });
  return { query, queryOne, client: {} };
}

function lockRow(unlocked = false) {
  return { week_start_date: WEEK, locked_at: LOCKED_AT, locked_by: 'hr-1',
    lock_reason: 'HR approved payroll snapshot',
    unlocked_at: unlocked ? '2026-08-10T03:00:00Z' : null,
    unlocked_by: unlocked ? 'hr-1' : null,
    unlock_reason: unlocked ? 'Correction required by HR' : null };
}
