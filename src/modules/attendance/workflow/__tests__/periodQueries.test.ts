import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  userHasPermission: vi.fn(async () => true),
}));

vi.mock('@/lib/db-pool', () => ({
  query: mocks.query,
  transaction: mocks.transaction,
}));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));

import {
  AttendancePeriodError,
  getPeriodReadiness,
  lockReadyWeek,
  unlockWeekWithHistory,
} from '../periodQueries';
import { rowsForUpdate, transitionRows, weekDays, type PeriodDayState } from './helpers/periodDayState';

const WEEK = '2026-08-03';

beforeEach(() => vi.clearAllMocks());

describe('getPeriodReadiness', () => {
  it('blocks a week containing unresolved worker and supervisor actions', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([{
        active_staff_count: 2, expected_day_count: 12, approved_day_count: 10,
        unapproved_overtime_hours: '2.5', unapproved_sunday_hours: '5',
        reconciliation_last_succeeded_at: '2026-08-10T01:00:00Z',
        reconciliation_fresh: true, active_lock: false,
      }])
      .mockResolvedValueOnce([
        { staff_id: 'staff-1', work_date: '2026-08-03', blocker_kind: 'awaiting_worker',
          exception_id: 'ex-1', exception_kind: 'missing_clock_out', exception_status: 'awaiting_worker' },
        { staff_id: 'staff-2', work_date: '2026-08-04', blocker_kind: 'awaiting_supervisor',
          exception_id: 'ex-2', exception_kind: 'outside_schedule', exception_status: 'awaiting_supervisor' },
      ]);

    const result = await getPeriodReadiness(WEEK, reader);

    expect(result).toMatchObject({
      weekStartDate: WEEK, weekEndDate: '2026-08-09', readyToLock: false,
      blockerCount: 2, unapprovedOvertimeHours: 2.5, unapprovedSundayHours: 5,
    });
    expect(result.blockers.map((item) => item.kind)).toEqual([
      'awaiting_worker', 'awaiting_supervisor',
    ]);
    expect(result.blockers[0]).toMatchObject({
      exceptionId: 'ex-1', exceptionKind: 'missing_clock_out', owner: 'worker',
      actionUrl: '/my/attendance/corrections/new?exception_id=ex-1',
    });
  });

  it('requires a strict ISO Monday and stable date projections', async () => {
    await expect(getPeriodReadiness('2026-08-04', vi.fn())).rejects.toMatchObject({
      code: 'invalid_week',
    });
    const reader = vi.fn()
      .mockResolvedValueOnce([{
        active_staff_count: 1, expected_day_count: 6, approved_day_count: 6,
        unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
        reconciliation_last_succeeded_at: '2026-08-10T01:00:00Z',
        reconciliation_fresh: true, active_lock: false,
      }])
      .mockResolvedValueOnce([]);
    await getPeriodReadiness(WEEK, reader);
    expect(reader.mock.calls.flatMap((call) => [call[0]])).toEqual(
      expect.arrayContaining([expect.stringMatching(/TO_CHAR\([^)]*work_date[^)]*,\s*'YYYY-MM-DD'\)/i)]),
    );
  });

  it.each([
    ['stale reconciliation', { reconciliation_fresh: false }],
    ['missing reconciliation', { reconciliation_last_succeeded_at: null, reconciliation_fresh: false }],
    ['an incomplete expected day', { expected_day_count: 6, approved_day_count: 5 }],
    ['unapproved overtime', { unapproved_overtime_hours: 1 }],
    ['unapproved Sunday time', { unapproved_sunday_hours: 5 }],
  ])('does not report ready for %s', async (_name, override) => {
    const reader = vi.fn()
      .mockResolvedValueOnce([{
        active_staff_count: 1, expected_day_count: 6, approved_day_count: 6,
        unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
        reconciliation_last_succeeded_at: '2026-08-10T01:00:00Z',
        reconciliation_fresh: true, active_lock: false, ...override,
      }])
      .mockResolvedValueOnce([]);
    await expect(getPeriodReadiness(WEEK, reader)).resolves.toMatchObject({ readyToLock: false });
  });

  it('defines freshness from the latest full-week run after reconciliation and decision mutations', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([{
        active_staff_count: 1, expected_day_count: 6, approved_day_count: 6,
        unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
        reconciliation_last_succeeded_at: '2026-08-10T01:00:00Z',
        reconciliation_fresh: true, active_lock: false,
      }])
      .mockResolvedValueOnce([]);
    await getPeriodReadiness(WEEK, reader);
    const sql = String(reader.mock.calls[0]?.[0]);
    expect(sql).toMatch(/scanned_from\s*<=\s*from_date.*scanned_to\s*>=\s*to_date/is);
    expect(sql).toMatch(/MAX\(ds\.computed_at\)/i);
    expect(sql).toMatch(/MAX\(de\.updated_at\)/i);
    expect(sql).toMatch(/status\s*=\s*'succeeded'.*finished_at\s*>=\s*changed_at/is);
  });
});

describe('weekly lock history transaction', () => {
  it('writes active lock, immutable history, locked results and an event atomically', async () => {
    const transactionLog: string[] = [];
    const tx = transactionDouble(transactionLog);
    mocks.transaction.mockImplementation(async (callback) => callback(tx));

    const locked = await lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved parallel payroll review',
    });

    expect(locked).toMatchObject({ weekStartDate: WEEK, version: 1, active: true });
    expect(transactionLog).toEqual(expect.arrayContaining([
      'attendance_weekly_locks', 'attendance_weekly_lock_history',
      'attendance_daily_summaries', 'attendance_decision_events',
    ]));
    expect(tx.query.mock.calls[0]?.[0]).toMatch(/pg_advisory_xact_lock/i);
    expect(tx.queryOne.mock.calls.some((call) => /FOR UPDATE/i.test(String(call[0])))).toBe(true);
  });

  it('rejects a concurrent active lock', async () => {
    const tx = transactionDouble([], { active: true });
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved payroll review',
    })).rejects.toMatchObject({ code: 'period_locked' });
  });

  it('requires HR permission and a ten-character reason to unlock', async () => {
    await expect(unlockWeekWithHistory({
      weekStartDate: WEEK, actorUserId: 'user-1', reason: ' short ',
    })).rejects.toMatchObject({ code: 'invalid_reason' });
    mocks.userHasPermission.mockResolvedValueOnce(false);
    const tx = transactionDouble([], { active: true });
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    await expect(unlockWeekWithHistory({
      weekStartDate: WEEK, actorUserId: 'user-1', reason: 'Correction required by HR',
    })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rolls back active state, history and daily status when a later write fails', async () => {
    const state: PeriodState = {
      active: false, history: [], days: weekDays(WEEK), decisionEvents: 0, failEvent: true,
    };
    mocks.transaction.mockImplementation(async (callback) => {
      const before = structuredClone(state);
      try { return await callback(transactionDouble([], state)); }
      catch (error) {
        for (const key of Object.keys(state)) delete (state as Record<string, unknown>)[key];
        Object.assign(state, before);
        throw error;
      }
    });
    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'HR approved payroll review',
    })).rejects.toThrow('decision event failed');
    expect(state).toEqual({
      active: false, history: [], days: weekDays(WEEK), decisionEvents: 0, failEvent: true,
    });
  });

  it('unlocks without deleting history and re-locks as version 2', async () => {
    const log: string[] = [];
    const state = { active: true, version: 1, history: ['lock'] };
    mocks.transaction.mockImplementation(async (callback) => callback(transactionDouble(log, state)));
    const unlocked = await unlockWeekWithHistory({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'Correction required by HR',
    });
    expect(unlocked).toMatchObject({ version: 1, active: false });
    expect(state).toMatchObject({ active: false, version: 1 });

    const relocked = await lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'Corrections reviewed and approved',
    });
    expect(relocked).toMatchObject({ version: 2, active: true });
    expect(state.history).toEqual(['lock', 'unlock', 'relock']);
  });

  it('returns only the locked version being unlocked to approved', async () => {
    const tx = transactionDouble([], { active: true, version: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback(tx));
    await unlockWeekWithHistory({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'Correction required by HR',
    });
    const call = tx.queryOne.mock.calls.find((item) => /UPDATE attendance_daily_summaries/i.test(String(item[0])));
    expect(call?.[0]).toMatch(/locked_period_version\s*=\s*\$6/i);
    expect(call?.[1]?.[5]).toBe(1);
  });

  it('fails closed when a locked day carries a different period version', async () => {
    const days = weekDays(WEEK, 'locked', 1);
    days[0]!.lockedPeriodVersion = 2;
    const tx = transactionDouble([], { active: true, version: 1, days });
    mocks.transaction.mockImplementation(async (callback) => {
      const before = structuredClone(days);
      try { return await callback(tx); }
      catch (error) { days.splice(0, days.length, ...before); throw error; }
    });

    await expect(unlockWeekWithHistory({
      weekStartDate: WEEK, actorUserId: 'hr-1', reason: 'Correction required by HR',
    })).rejects.toMatchObject({ code: 'persisted_readback_failed' });
    expect(days.every((day) => day.status === 'locked')).toBe(true);
  });
});

interface PeriodState {
  active: boolean; version?: number; history?: string[];
  days?: PeriodDayState[]; decisionEvents?: number; failEvent?: boolean;
}

function transactionDouble(log: string[], seed: PeriodState = { active: false }) {
  const state = seed;
  state.history ??= state.version ? ['lock'] : [];
  state.days ??= weekDays(WEEK, state.active ? 'locked' : 'approved', state.version ?? 1);
  state.decisionEvents ??= 0;
  const queryOne = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/FROM users/i.test(text)) return { role: 'admin' };
    if (/FROM attendance_weekly_locks/i.test(text) && /FOR UPDATE/i.test(text)) {
      return state.active ? lockRow(state.version ?? 1) : state.version ? lockRow(state.version, true) : null;
    }
    if (/FROM attendance_weekly_lock_history/i.test(text) && /FOR UPDATE/i.test(text)) {
      return state.version ? { lock_version: state.version, result_snapshot: { dailyResults: [] } } : null;
    }
    if (/INSERT INTO attendance_weekly_locks|UPDATE attendance_weekly_locks/i.test(text)) {
      log.push('attendance_weekly_locks');
      state.active = /INSERT INTO|unlocked_at\s*=\s*NULL/i.test(text);
      return lockRow(state.version ?? 1, !state.active);
    }
    if (/INSERT INTO attendance_weekly_lock_history/i.test(text)) {
      log.push('attendance_weekly_lock_history');
      const action = String(params[2]);
      state.history!.push(action);
      if (action === 'lock' || action === 'relock') state.version = Number(params[1]);
      return { lock_version: state.version ?? 1 };
    }
    if (/UPDATE attendance_daily_summaries/i.test(text)) {
      log.push('attendance_daily_summaries');
      return { affected_count: transitionRows(state.days!, params) };
    }
    if (/INSERT INTO attendance_decision_events/i.test(text)) {
      if (state.failEvent) throw new Error('decision event failed');
      log.push('attendance_decision_events');
      state.decisionEvents += 1;
      return { id: 'event-1' };
    }
    if (/SELECT .*attendance_weekly_locks/i.test(text)) return lockRow(state.version ?? 1, !state.active);
    return null;
  });
  const query = vi.fn(async (text: string, params: unknown[] = []) => {
    if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
    if (/FROM attendance_daily_summaries/i.test(text) && /FOR UPDATE/i.test(text)) {
      const status = /result_status = 'locked'/i.test(text) ? 'locked' : 'approved';
      return rowsForUpdate(state.days!, String(params[0]), String(params[1]), status,
        undefined);
    }
    if (/active_staff_count/i.test(text)) return [{
      active_staff_count: 1, expected_day_count: 6,
      approved_day_count: state.days!.filter((day) => day.status === 'approved').length,
      unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
      reconciliation_last_succeeded_at: '2026-08-10T01:00:00Z',
      reconciliation_fresh: true, active_lock: state.active,
    }];
    if (/blocker_kind/i.test(text)) return [];
    return [];
  });
  return { query, queryOne, client: {} };
}

function lockRow(version: number, unlocked = false) {
  return {
    week_start_date: WEEK, locked_at: '2026-08-10T02:00:00Z', locked_by: 'hr-1',
    lock_reason: 'Payroll review', unlocked_at: unlocked ? '2026-08-10T03:00:00Z' : null,
    unlocked_by: unlocked ? 'hr-1' : null, unlock_reason: unlocked ? 'Correction required by HR' : null,
    lock_version: version,
  };
}

expect(AttendancePeriodError).toBeDefined();
