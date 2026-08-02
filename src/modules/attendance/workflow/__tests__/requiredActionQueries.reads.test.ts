import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => mocks);

import { findRequiredAttendanceAction } from '../requiredActionQueries';

const EXCEPTION_ROW = {
  exception_id: 'exception-1',
  entry_id: 'entry-1',
  work_date: '2026-07-31',
  kind: 'missing_clock_out',
  proposed_regular_hours: '8',
  proposed_overtime_hours: '0',
  proposed_sunday_hours: '0',
  proposed_holiday_hours: '0',
  clock_in_at: '2026-07-31T06:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

describe('findRequiredAttendanceAction', () => {
  it('returns the oldest prior awaiting-worker missing-clock-out action', async () => {
    mocks.query.mockResolvedValueOnce([EXCEPTION_ROW]);

    await expect(findRequiredAttendanceAction('staff-1', '2026-08-01')).resolves.toEqual({
      exceptionId: 'exception-1',
      entryId: 'entry-1',
      workDate: '2026-07-31',
      kind: 'missing_clock_out',
      provisionalPaidHours: 8,
      clockInAt: '2026-07-31T06:00:00.000Z',
    });

    const [text, params] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(text).toContain("de.status = 'awaiting_worker'");
    expect(text).toContain("de.kind = 'missing_clock_out'");
    expect(text).toContain('de.work_date < $2::date');
    expect(text).toContain('de.adjustment_id IS NULL');
    expect(params).toEqual(['staff-1', '2026-08-01']);
  });

  it('sums the Sunday provisional bucket', async () => {
    mocks.query.mockResolvedValueOnce([{
      ...EXCEPTION_ROW, proposed_regular_hours: '0', proposed_sunday_hours: '5',
    }]);

    await expect(findRequiredAttendanceAction('staff-1', '2026-08-01'))
      .resolves.toMatchObject({ provisionalPaidHours: 5 });
  });

  it('sums the public-holiday provisional bucket', async () => {
    mocks.query.mockResolvedValueOnce([{
      ...EXCEPTION_ROW, proposed_regular_hours: '0', proposed_holiday_hours: '8',
    }]);

    await expect(findRequiredAttendanceAction('staff-1', '2026-08-01'))
      .resolves.toMatchObject({ provisionalPaidHours: 8 });
  });
});
