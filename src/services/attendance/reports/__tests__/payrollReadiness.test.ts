import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: { query: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { ReportTooLargeError } from '../runner';
import { runPayrollReadiness } from '../payrollReadiness';
import type { ReportInput } from '../types';

function input(scopedStaffIds: string[] | null): ReportInput {
  return {
    scopedStaffIds, hasAnyStaff: scopedStaffIds === null || scopedStaffIds.length > 0,
    scope: {} as ReportInput['scope'], dateFrom: '2026-07-27', dateTo: '2026-08-02',
    departments: [], siteIds: [], staffIdsHint: [],
  };
}

function day(overrides: Record<string, unknown>) {
  return {
    work_date: '2026-07-27', result_status: 'approved', blocker_exception_id: null,
    pending_adjustment: false, summary_eligible: true,
    active_lock: false, latest_lock_version: null, latest_lock_action: null,
    locked_period_version: null, approved_regular_hrs: 0, approved_overtime_hrs: 0,
    approved_sunday_hrs: 0, approved_holiday_hrs: 0, leave_hrs: 0, unpaid_hrs: 0,
    ...overrides,
  };
}

const WORKER_FACTS = [{
  staff_id: 'staff-1', full_name: 'Alice Worker', department: 'Build',
  days: [
    day({ work_date: '2026-07-27', result_status: 'locked', active_lock: true,
      latest_lock_version: 10, latest_lock_action: 'lock', locked_period_version: 10,
      approved_regular_hrs: 8, approved_overtime_hrs: 1 }),
    day({ work_date: '2026-07-28', result_status: 'locked', active_lock: true,
      latest_lock_version: 2, latest_lock_action: 'relock', locked_period_version: 2,
      approved_regular_hrs: 5 }),
    day({ work_date: '2026-07-29', result_status: 'locked', active_lock: true,
      latest_lock_version: 1, latest_lock_action: 'lock', locked_period_version: 1,
      approved_regular_hrs: 4 }),
    day({ work_date: '2026-07-30', result_status: 'locked', active_lock: true,
      latest_lock_version: 4, latest_lock_action: 'lock', locked_period_version: 3,
      approved_regular_hrs: 99 }),
    day({ work_date: '2026-07-31', approved_regular_hrs: 7, approved_sunday_hrs: 2 }),
    day({ work_date: '2026-08-01', approved_regular_hrs: 99, blocker_exception_id: 'exception-1' }),
    day({ work_date: '2026-08-02', result_status: null }),
  ],
}];

beforeEach(() => {
  sqlMock.query.mockReset();
  sqlMock.query.mockResolvedValue(structuredClone(WORKER_FACTS));
});

describe('runPayrollReadiness', () => {
  it('aggregates only approved and exact active-lock days and sorts versions numerically', async () => {
    const result = await runPayrollReadiness(input(['staff-1']));
    expect(result.rows).toEqual([{
      worker: 'Alice Worker', department: 'Build', expected_days: 7, approved_days: 4,
      blocked_days: 3, readiness_status: 'blocked', approved_regular_hours: 24,
      approved_overtime_hours: 1, approved_sunday_hours: 2, approved_holiday_hours: 0,
      approved_leave_hours: 0, unpaid_hours: 0, lock_versions: '1,2,10',
    }]);
    expect(Object.keys(result.rows[0] ?? {})).toEqual(result.columns.map((column) => column.key));
  });

  it('changes totals when persisted lock authority mutates', async () => {
    const facts = structuredClone(WORKER_FACTS);
    facts[0]!.days[0]!.latest_lock_version = 11;
    sqlMock.query.mockResolvedValueOnce(facts);
    const result = await runPayrollReadiness(input(['staff-1']));
    expect(result.rows[0]).toMatchObject({
      expected_days: 7, approved_days: 3, blocked_days: 4,
      approved_regular_hours: 16, approved_overtime_hours: 0, lock_versions: '1,2',
    });
  });

  it('does not treat absent lock versions as an exact match', async () => {
    sqlMock.query.mockResolvedValueOnce([{
      staff_id: 'staff-1', full_name: 'Alice Worker', department: 'Build',
      days: [day({ result_status: 'locked', active_lock: true, latest_lock_action: 'lock' })],
    }]);
    const result = await runPayrollReadiness(input(['staff-1']));
    expect(result.rows[0]).toMatchObject({ approved_days: 0, blocked_days: 1, lock_versions: '' });
  });

  it('blocks malformed approved summaries and pending adjustments', async () => {
    sqlMock.query.mockResolvedValueOnce([{
      staff_id: 'staff-1', full_name: 'Alice Worker', department: 'Build',
      days: [
        day({ summary_eligible: false, approved_regular_hrs: 20, approved_overtime_hrs: 10 }),
        day({ work_date: '2026-07-28', pending_adjustment: true }),
      ],
    }]);

    await expect(runPayrollReadiness(input(['staff-1']))).resolves.toMatchObject({
      rows: [{ expected_days: 2, approved_days: 0, blocked_days: 2, readiness_status: 'blocked' }],
    });
  });

  it('binds date and supervisor scope and never exposes money or rates', async () => {
    const result = await runPayrollReadiness(input(['staff-1']));
    const [query, params] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(query).toContain('s.id = ANY($3::uuid[])');
    expect(params).toEqual(['2026-07-27', '2026-08-02', ['staff-1'], 50_001]);
    expect(result.columns.some((column) => /money|wage|rate/i.test(`${column.key} ${column.label}`))).toBe(false);
    expect(query).toContain('s.join_date::date <= w.work_date');
    expect(query).toContain('s.end_date::date >= w.work_date');
    expect(query).toContain("LOWER(s.account_status) <> 'pending'");
    expect(query).toMatch(/ds\.approved_at\s+IS NOT NULL/i);
    expect(query).toMatch(/approved_regular_hrs[\s\S]*unpaid_hrs[\s\S]*<=\s*24/i);
    expect(query).toMatch(/attendance_adjustments\s+aa[\s\S]*aa\.status\s*=\s*'pending'/i);
  });

  it('keeps explicit organisation scope free of a staff ANY predicate', async () => {
    await runPayrollReadiness(input(null));
    const [query, params] = sqlMock.query.mock.calls[0] as [string, unknown[]];
    expect(query).not.toContain('s.id = ANY(');
    expect(params).toEqual(['2026-07-27', '2026-08-02', 50_001]);
  });

  it('returns no rows for an empty scope without querying', async () => {
    const result = await runPayrollReadiness(input([]));
    expect(result.rows).toEqual([]);
    expect(result.columns.length).toBeGreaterThan(0);
    expect(sqlMock.query).not.toHaveBeenCalled();
  });

  it('enforces the shared row cap', async () => {
    sqlMock.query.mockResolvedValueOnce(Array.from({ length: 50_001 }, (_, index) => ({
      ...WORKER_FACTS[0], staff_id: `staff-${index}`,
    })));
    await expect(runPayrollReadiness(input(null))).rejects.toBeInstanceOf(ReportTooLargeError);
  });
});
