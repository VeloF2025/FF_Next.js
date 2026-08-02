import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TxnClient } from '@/lib/db-pool';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import {
  acquireAttendanceWeekLock,
  ATTENDANCE_WEEK_LOCK_NAMESPACE,
  upsertWeeklyLock,
} from '../lockQueries';

beforeEach(() => vi.clearAllMocks());

describe('attendance weekly lock serialization', () => {
  it('takes the shared advisory lock before the weekly-lock upsert', async () => {
    mocks.sql.mockResolvedValueOnce([{
      week_start_date: '2026-07-27', locked_at: '2026-08-01T10:00:00Z',
      locked_by: 'staff-1', lock_reason: null, unlocked_at: null,
      unlocked_by: null, unlock_reason: null,
    }]);

    await upsertWeeklyLock({
      weekStartDate: '2026-07-27', lockedBy: 'staff-1', lockReason: null,
    });

    const [strings, ...values] = mocks.sql.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    const text = strings.join('?');
    expect(text.indexOf('pg_advisory_xact_lock')).toBeLessThan(
      text.indexOf('INSERT INTO attendance_weekly_locks'),
    );
    expect(values).toContain(ATTENDANCE_WEEK_LOCK_NAMESPACE);
    expect(values).toContain('2026-07-27');
  });

  it('uses the same transaction advisory key for correction writes', async () => {
    const query = vi.fn().mockResolvedValue([{ acquired: '' }]);
    const tx = { query } as unknown as TxnClient;

    await acquireAttendanceWeekLock(tx, '2026-07-27');

    const [text, params] = query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain('pg_advisory_xact_lock');
    expect(params).toEqual([ATTENDANCE_WEEK_LOCK_NAMESPACE, '2026-07-27']);
  });
});
