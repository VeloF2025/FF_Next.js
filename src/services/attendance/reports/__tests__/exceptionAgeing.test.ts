import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: { query: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { ReportTooLargeError } from '../runner';
import { runExceptionAgeing } from '../exceptionAgeing';
import type { ReportInput } from '../types';

function input(scopedStaffIds: string[] | null): ReportInput {
  return {
    scopedStaffIds, hasAnyStaff: scopedStaffIds === null || scopedStaffIds.length > 0,
    scope: {} as ReportInput['scope'], dateFrom: '2026-07-01', dateTo: '2026-08-02',
    departments: [], siteIds: [], staffIdsHint: [],
  };
}

const FACTS = [{
  exception_id: 'exception-1', staff_id: 'staff-1', full_name: 'Alice Worker', department: 'Build',
  work_date: '2026-07-31', entry_id: 'entry-1', kind: 'missing_clock_out',
  status: 'awaiting_worker', owner_user_id: null, created_at: '2026-07-31T22:30:00.000Z',
}];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-02T10:00:00.000Z'));
  sqlMock.query.mockReset();
  sqlMock.query.mockResolvedValue(structuredClone(FACTS));
});

afterEach(() => vi.useRealTimers());

describe('runExceptionAgeing', () => {
  it('maps persisted timestamps to SAST calendar age and worker action', async () => {
    const result = await runExceptionAgeing(input(['staff-1']));
    expect(result.rows).toEqual([{
      worker: 'Alice Worker', work_date: '2026-07-31', kind: 'missing_clock_out',
      owner: 'worker', status: 'awaiting_worker', age_days: 1,
      action_url: '/my/attendance/corrections/new?entry_id=entry-1&exception_id=exception-1',
    }]);
    expect(Object.keys(result.rows[0] ?? {})).toEqual(result.columns.map((column) => column.key));
  });

  it('changes owner and action when persisted status mutates', async () => {
    sqlMock.query.mockResolvedValueOnce([{ ...FACTS[0], status: 'open', entry_id: null }]);
    const result = await runExceptionAgeing(input(null));
    expect(result.rows[0]).toMatchObject({
      owner: 'supervisor', status: 'open',
      action_url: '/staff/attendance/corrections?exception_id=exception-1',
    });
  });

  it('binds unresolved date and supervisor scope contracts', async () => {
    await runExceptionAgeing(input(['staff-1']));
    const [query, params] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(query).toContain("de.status IN ('open', 'awaiting_worker', 'awaiting_supervisor')");
    expect(query).toContain('de.staff_id = ANY($3::uuid[])');
    expect(params).toEqual(['2026-07-01', '2026-08-02', ['staff-1'], 50_001]);
    expect(query).toContain('s.join_date::date <= de.work_date');
    expect(query).toContain('s.end_date::date >= de.work_date');
  });

  it('returns no rows for an empty scope without querying', async () => {
    const result = await runExceptionAgeing(input([]));
    expect(result.rows).toEqual([]);
    expect(result.columns.length).toBeGreaterThan(0);
    expect(sqlMock.query).not.toHaveBeenCalled();
  });

  it('enforces the shared row cap', async () => {
    sqlMock.query.mockResolvedValueOnce(Array.from({ length: 50_001 }, (_, index) => ({
      ...FACTS[0], exception_id: `exception-${index}`,
    })));
    await expect(runExceptionAgeing(input(null))).rejects.toBeInstanceOf(ReportTooLargeError);
  });
});
