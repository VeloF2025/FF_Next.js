import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), userHasPermission: vi.fn(async () => true),
}));
vi.mock('@/lib/db-pool', () => ({ query: vi.fn(), transaction: mocks.transaction }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));

import { lockReadyWeeks } from '../periodQueries';
import { rowsForUpdate, transitionRows, weekDays, type PeriodDayState } from './helpers/periodDayState';

const FIRST = '2026-08-03';
const SECOND = '2026-08-10';

beforeEach(() => vi.clearAllMocks());

describe('atomic multi-week readiness authority', () => {
  it('preflights every selected week before writing the first lock', async () => {
    const writes: string[] = [];
    const tx = bulkTxn(writes, SECOND);
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    await expect(lockReadyWeeks({
      weekStartDates: [FIRST, SECOND], actorUserId: 'hr-1', reason: 'Payroll batch ready',
    })).rejects.toMatchObject({ code: 'period_locked' });

    expect(writes).toEqual([]);
    expect(tx.query.mock.calls.slice(0, 2).every((call) => /pg_advisory_xact_lock/i.test(call[0]))).toBe(true);
  });

  it('keeps lock writes and the caller audit finalizer in one rollback boundary', async () => {
    const state = { active: false, history: 0, days: [...weekDays(FIRST), ...weekDays(SECOND)] };
    const tx = bulkTxn([], null, state);
    mocks.transaction.mockImplementation(async (callback) => {
      const before = structuredClone(state);
      try { return await callback(tx); }
      catch (error) {
        state.active = before.active; state.history = before.history;
        state.days.splice(0, state.days.length, ...before.days);
        throw error;
      }
    });

    await expect(lockReadyWeeks({
      weekStartDates: [FIRST, SECOND], actorUserId: 'hr-1', reason: 'Payroll batch ready',
    }, async (_tx, locks) => {
      expect(locks).toHaveLength(2);
      expect(state.history).toBe(2);
      throw new Error('bulk audit failed');
    })).rejects.toThrow('bulk audit failed');

    const snapshots = tx.queryOne.mock.calls
      .filter((call) => /INSERT INTO attendance_weekly_lock_history/i.test(String(call[0])))
      .map((call) => JSON.parse(String(call[1]?.[5])).payrollSnapshot);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((snapshot) => snapshot.rows[0].work_date)).toEqual([FIRST, SECOND]);
    expect(snapshots.every((snapshot) => snapshot.version === 1 &&
      snapshot.rows.every((row: { result_version: number; locked_period_version: number }) =>
        row.result_version === 2 && row.locked_period_version === 1))).toBe(true);
    expect(state).toEqual({ active: false, history: 0, days: [...weekDays(FIRST), ...weekDays(SECOND)] });
  });
});

function bulkTxn(
  writes: string[], activeWeek: string | null,
  state: { active: boolean; history: number; days: PeriodDayState[] } = {
    active: false, history: 0, days: [...weekDays(FIRST), ...weekDays(SECOND)],
  },
) {
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
    if (/active_staff_count/i.test(text)) return [{
      active_staff_count: 1, expected_day_count: 6, approved_day_count: 6,
      unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
      reconciliation_last_succeeded_at: '2026-08-17T02:00:00Z',
      reconciliation_fresh: true, active_lock: params[0] === activeWeek,
    }];
    if (/blocker_kind/i.test(text)) return [];
    if (/FROM attendance_daily_summaries/i.test(text) && /FOR UPDATE/i.test(text)) {
      return rowsForUpdate(state.days, String(params[0]), String(params[1]), 'approved');
    }
    return [];
  });
  const queryOne = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/FROM users/i.test(text)) return { role: 'admin' };
    if (/FROM attendance_weekly_locks/i.test(text) && /FOR UPDATE/i.test(text)) {
      return params[0] === activeWeek ? lockRow(String(params[0])) : null;
    }
    if (/FROM attendance_weekly_lock_history/i.test(text)) return null;
    if (/INSERT INTO attendance_weekly_locks/i.test(text)) {
      writes.push(`lock:${params[0]}`); state.active = true; return lockRow(String(params[0]));
    }
    if (/INSERT INTO attendance_weekly_lock_history/i.test(text)) {
      writes.push(`history:${params[0]}`); state.history += 1; return { lock_version: 1 };
    }
    if (/UPDATE attendance_daily_summaries/i.test(text)) {
      writes.push(`daily:${params[0]}`);
      return { affected_count: transitionRows(state.days, params) };
    }
    if (/INSERT INTO attendance_decision_events/i.test(text)) return { id: 'event-1' };
    if (/SELECT .*FROM attendance_weekly_locks/i.test(text)) return lockRow(String(params[0]));
    return null;
  });
  return { query, queryOne, client: {} };
}

function lockRow(week: string) {
  return { week_start_date: week, locked_at: '2026-08-17T02:00:00Z', locked_by: 'hr-1',
    lock_reason: 'Payroll batch ready', unlocked_at: null, unlocked_by: null, unlock_reason: null };
}
