import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(), transaction: vi.fn(), lockReadyWeeks: vi.fn(),
}));
vi.mock('@/lib/db-pool', () => ({
  sql: mocks.sql, transaction: mocks.transaction,
}));
vi.mock('@/modules/attendance/workflow/periodQueries', () => ({
  lockReadyWeeks: mocks.lockReadyWeeks,
  AttendancePeriodError: class AttendancePeriodError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

import { BulkAuthorityError, BulkConflict, runBulkLock } from '../bulkActions';

const WEEKS = ['2026-08-03', '2026-08-10'];
const user = { id: 'admin-1', role: 'admin' } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sql.mockResolvedValue([{ staff_id: 'staff-1' }]);
  mocks.transaction.mockRejectedValue(new Error('legacy direct-lock transaction invoked'));
});

describe('bulk lock readiness authority', () => {
  it('uses the multi-week authority and writes only audit SQL in its finalizer', async () => {
    const executed: string[] = [];
    mocks.lockReadyWeeks.mockImplementation(async (args, finalize) => {
      const tx = {
        queryOne: vi.fn(async () => ({ id: 'batch-1' })),
        query: vi.fn(async (text: string) => {
          if (/attendance_weekly_locks|attendance_weekly_lock_history|attendance_decision_events/i.test(text)) {
            throw new Error('bulk service attempted direct lock SQL');
          }
          executed.push(text);
          return [];
        }), client: {},
      };
      const locks = args.weekStartDates.map((weekStartDate: string, index: number) => ({
        weekStartDate, version: index + 1, active: true,
      }));
      return { locks, value: await finalize(tx, locks) };
    });

    const result = await runBulkLock(user, { weekStartDates: WEEKS, reason: 'Payroll batch ready' });

    expect(result).toEqual({ batchId: 'batch-1', weeks: WEEKS, staffAudited: 2, locksCreated: 2 });
    expect(mocks.lockReadyWeeks).toHaveBeenCalledWith(expect.objectContaining({
      weekStartDates: WEEKS, actorUserId: 'admin-1', reason: 'Payroll batch ready',
    }), expect.any(Function));
    expect(executed).toHaveLength(2);
    expect(executed.every((text) => /attendance_bulk_action_audit/i.test(text))).toBe(true);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('fails the whole batch with a stable conflict when any week is not ready', async () => {
    mocks.lockReadyWeeks.mockRejectedValueOnce(
      Object.assign(new Error('Week 2026-08-10 has blockers'), { code: 'period_has_blockers' }),
    );
    await expect(runBulkLock(user, {
      weekStartDates: WEEKS, reason: 'Payroll batch ready',
    })).rejects.toMatchObject<BulkConflict>({
      name: 'BulkConflict', reason: 'period_has_blockers',
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('denies a manager before resolving any attendance scope', async () => {
    await expect(runBulkLock({ id: 'manager-1', role: 'manager' } as never, {
      weekStartDates: WEEKS, reason: 'Payroll batch ready',
    })).rejects.toBeInstanceOf(BulkAuthorityError);
    expect(mocks.sql).not.toHaveBeenCalled();
    expect(mocks.lockReadyWeeks).not.toHaveBeenCalled();
  });
});
