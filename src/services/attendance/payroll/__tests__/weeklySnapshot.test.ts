import type { TxnClient } from '@/lib/db-pool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@/lib/db-pool', () => mocks);

import { createWeeklyPayrollSnapshotReader, loadWeeklyPayrollSnapshot } from '../weeklySnapshot';
import { daily } from './payrollFake';

const WEEK = '2026-08-03';
const LOCK = {
  week_start_date: WEEK, locked_at: '2026-08-03T15:00:00.000Z',
  locked_by: 'admin-1', lock_reason: 'approved', unlocked_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue([]);
  mocks.queryOne.mockResolvedValue(null);
});

function reader(overrides: Record<string, unknown> = {}) {
  const frozen = daily();
  return createWeeklyPayrollSnapshotReader({
    readActiveLock: async () => LOCK,
    readLatestHistory: async () => ({
      lock_version: 3, action: 'lock', actor_user_id: 'admin-1', reason: 'approved',
      recorded_at: LOCK.locked_at,
      result_snapshot: { payrollSnapshot: { version: 1, rows: [frozen] } },
    }),
    readLockedDays: async () => [frozen],
    ...overrides,
  });
}

describe('weekly locked payroll snapshot', () => {
  it('returns all six frozen categories from the exact active lock version', async () => {
    const load = reader();

    await expect(load(WEEK, '2026-08-09')).resolves.toMatchObject({
      lock: { version: 3, lockedAt: LOCK.locked_at, lockedBy: 'admin-1' },
      totals: {
        regularHrs: 8, overtimeHrs: 0, sundayHrs: 0,
        holidayHrs: 0, leaveHrs: 0, unpaidHrs: 0,
      },
    });
  });

  it('rejects a wrong-version live row instead of exposing mutable totals', async () => {
    const load = reader({
      readLockedDays: async () => [daily({ locked_period_version: 2 })],
    });

    await expect(load(WEEK, '2026-08-09')).rejects.toMatchObject({
      code: 'export_version_conflict',
    });
  });

  it('rejects an orphan live row absent from the immutable snapshot', async () => {
    const load = reader({
      readLockedDays: async () => [daily(), daily({ staff_id: 'orphan', work_date: '2026-08-04' })],
    });

    await expect(load(WEEK, '2026-08-09')).rejects.toMatchObject({
      code: 'export_version_conflict',
    });
  });

  it('rejects locked rows whose weekly lock has been removed', async () => {
    const load = reader({
      readActiveLock: async () => null,
      readLockedDays: async () => [daily()],
    });

    await expect(load(WEEK, '2026-08-09')).rejects.toMatchObject({
      code: 'export_version_conflict',
    });
  });

  it('loads the default snapshot under the same weekly advisory transaction lock', async () => {
    const frozen = daily();
    const calls: string[] = [];
    const tx = {
      query: vi.fn(async (text: string) => {
        calls.push(text);
        if (/pg_advisory_xact_lock/i.test(text)) return [{ acquired: '' }];
        if (/payroll:weekly-locked-days/i.test(text)) return [frozen];
        return [];
      }),
      queryOne: vi.fn(async (text: string) => {
        calls.push(text);
        if (/payroll:weekly-active-lock/i.test(text)) return LOCK;
        if (/payroll:weekly-lock-history/i.test(text)) return {
          lock_version: 3, action: 'lock', actor_user_id: 'admin-1', reason: 'approved',
          recorded_at: LOCK.locked_at,
          result_snapshot: { payrollSnapshot: { version: 1, rows: [frozen] } },
        };
        return null;
      }),
      client: {},
    } as unknown as TxnClient;
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(loadWeeklyPayrollSnapshot(WEEK, '2026-08-09')).resolves.toMatchObject({
      lock: { version: 3 }, totals: { regularHrs: 8 },
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(calls[0]).toMatch(/pg_advisory_xact_lock/i);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });
});
