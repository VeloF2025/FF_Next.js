import type { TxnClient } from '@/lib/db-pool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(), transaction: vi.fn(), userHasPermission: vi.fn(async () => true),
}));
vi.mock('@/lib/db-pool', () => ({ query: mocks.query, transaction: mocks.transaction }));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));

import { getPeriodReadiness, lockReadyWeek, unlockWeekWithHistory } from '../periodQueries';

const WEEK = '2026-08-03';

beforeEach(() => vi.clearAllMocks());

describe('readiness hardening', () => {
  it('invalidates freshness after raw entry or adjustment mutations', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([metrics()])
      .mockResolvedValueOnce([]);

    await getPeriodReadiness(WEEK, reader);

    const sql = String(reader.mock.calls[0]?.[0]);
    expect(sql).toMatch(/MAX\(ae\.updated_at\)/i);
    expect(sql).toMatch(/attendance_entries\s+ae[\s\S]*?ae\.work_date\s+BETWEEN\s+from_date\s+AND\s+to_date/i);
    expect(sql).toMatch(/MAX\(aa\.updated_at\)/i);
    expect(sql).toMatch(/attendance_adjustments\s+aa[\s\S]*?JOIN\s+attendance_entries\s+aae\s+ON\s+aae\.id\s*=\s*aa\.entry_id/i);
    expect(sql).toMatch(/aae\.work_date\s+BETWEEN\s+from_date\s+AND\s+to_date/i);
    expect(sql).toMatch(/finished_at\s*>=\s*changed_at/i);
  });

  it('counts only approved results and exposes orphan locked rows as HR blockers', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([metrics({ approved_day_count: 5 })])
      .mockResolvedValueOnce([{
        staff_id: 'staff-1', work_date: WEEK, blocker_kind: 'orphan_locked_result',
        exception_id: null, exception_kind: null, exception_status: 'locked',
      }]);

    const result = await getPeriodReadiness(WEEK, reader);

    expect(result).toMatchObject({ approvedDayCount: 5, blockerCount: 1, readyToLock: false });
    expect(result.blockers[0]).toMatchObject({
      kind: 'orphan_locked_result', owner: 'hr',
      actionUrl: `/staff/attendance/locks?week=${WEEK}`,
    });
    const metricsSql = String(reader.mock.calls[0]?.[0]);
    const blockerSql = String(reader.mock.calls[1]?.[0]);
    expect(metricsSql).toMatch(/FILTER\s*\(WHERE\s+ds\.result_status\s*=\s*'approved'[\s\S]*?\)/i);
    expect(metricsSql).not.toMatch(/COUNT\(ds\.staff_id\)\s+FILTER\s*\(WHERE\s+ds\.result_status\s+IN/i);
    for (const column of [
      'approved_regular_hrs', 'approved_overtime_hrs', 'approved_sunday_hrs',
      'approved_holiday_hrs', 'leave_hrs', 'unpaid_hrs',
    ]) expect(metricsSql).toMatch(new RegExp(`ds\\.${column}\\s+IS NOT NULL`, 'i'));
    expect(metricsSql).toMatch(/ds\.approved_at\s+IS NOT NULL/i);
    expect(metricsSql).toMatch(
      /approved_regular_hrs[\s\S]*approved_overtime_hrs[\s\S]*approved_sunday_hrs[\s\S]*approved_holiday_hrs[\s\S]*leave_hrs[\s\S]*unpaid_hrs[\s\S]*<=\s*24/i,
    );
    expect(metricsSql).toMatch(/CASE\s+ds\.attendance_classification/i);
    expect(metricsSql).toMatch(/SUM\(ds2\.proposed_overtime_hrs\)[\s\S]*?ds2\.result_status\s+NOT\s+IN\s*\('approved',\s*'locked'\)/i);
    expect(metricsSql).toMatch(/SUM\(ds2\.proposed_sunday_hrs\)[\s\S]*?ds2\.result_status\s+NOT\s+IN\s*\('approved',\s*'locked'\)/i);
    expect(blockerSql).toContain("'orphan_locked_result'");
    expect(blockerSql).toContain("'pending_adjustment'");
    expect(blockerSql).toMatch(/attendance_adjustments\s+aa[\s\S]*?aa\.status\s*=\s*'pending'/i);
  });

  it('uses employment-effective worker-days in both readiness queries', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([metrics()])
      .mockResolvedValueOnce([]);

    await getPeriodReadiness(WEEK, reader);

    for (const sql of reader.mock.calls.map((call) => String(call[0]))) {
      expect(sql).toContain('s.join_date::date <= w.work_date');
      expect(sql).toContain('s.end_date::date >= w.work_date');
      expect(sql).toContain("LOWER(s.account_status) <> 'pending'");
    }
  });

  it('keeps optional Sunday work and its unresolved writes in readiness scope', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([metrics({ unapproved_sunday_hours: 5 })])
      .mockResolvedValueOnce([]);

    const result = await getPeriodReadiness(WEEK, reader);
    const metricsQuery = String(reader.mock.calls[0]?.[0]);
    const blockersQuery = String(reader.mock.calls[1]?.[0]);

    expect(result).toMatchObject({ unapprovedSundayHours: 5, readyToLock: false });
    expect(metricsQuery).toMatch(
      /SUM\(ds2\.proposed_sunday_hrs\)[\s\S]*ds2\.work_date\s+BETWEEN\s+from_date\s+AND\s+to_date/i,
    );
    expect(metricsQuery).toContain('s2.join_date::date <= ds2.work_date');
    expect(blockersQuery).toMatch(
      /attendance_day_exceptions\s+de\s+JOIN\s+staff\s+sde[\s\S]*de\.work_date\s+BETWEEN\s+\$1::date\s+AND\s+\$2::date/i,
    );
    expect(blockersQuery).toMatch(
      /attendance_adjustments\s+aa[\s\S]*JOIN\s+staff\s+saa[\s\S]*ae\.work_date\s+BETWEEN\s+\$1::date\s+AND\s+\$2::date/i,
    );
    expect(blockersQuery).toMatch(
      /attendance_daily_summaries\s+ds\s+JOIN\s+staff\s+sds[\s\S]*ds\.work_date\s+BETWEEN\s+\$1::date\s+AND\s+\$2::date/i,
    );
  });

  it('blocks an approved row whose payroll identity cannot be snapshotted', async () => {
    const reader = vi.fn()
      .mockResolvedValueOnce([metrics()])
      .mockResolvedValueOnce([{
        staff_id: 'staff-1', work_date: WEEK, blocker_kind: 'incomplete_payroll_snapshot',
        exception_id: null, exception_kind: null, exception_status: 'approved',
      }]);

    const result = await getPeriodReadiness(WEEK, reader);
    const blockersQuery = String(reader.mock.calls[1]?.[0]);

    expect(result).toMatchObject({ blockerCount: 1, readyToLock: false });
    expect(result.blockers[0]).toMatchObject({
      kind: 'incomplete_payroll_snapshot', owner: 'hr',
      actionUrl: `/staff/attendance/locks?week=${WEEK}`,
    });
    expect(blockersQuery).toContain("'incomplete_payroll_snapshot'");
    expect(blockersQuery).toMatch(/NULLIF\(TRIM\(sident\.employee_id\),\s*''\)\s+IS\s+NULL/i);
    expect(blockersQuery).toMatch(
      /NULLIF\(TRIM\(COALESCE\(sident\.first_name,\s*''\)[\s\S]*COALESCE\(sident\.last_name,\s*''\)[\s\S]*IS\s+NULL/i,
    );
    expect(blockersQuery).toMatch(/ds\.result_version\s+IS\s+NULL[\s\S]*ds\.result_version\s*<\s*1/i);
  });

  it('denies a manager even when the legacy permission row still grants create', async () => {
    const tx = managerTxn();
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(lockReadyWeek({
      weekStartDate: WEEK, actorUserId: 'manager-1', reason: 'Manager payroll close',
    })).rejects.toMatchObject({ code: 'forbidden' });

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(tx.queryOne).toHaveBeenCalledTimes(1);
  });

  it('denies a manager unlock even when the legacy permission row still grants edit', async () => {
    const tx = managerTxn();
    mocks.transaction.mockImplementation(async (work) => work(tx));

    await expect(unlockWeekWithHistory({
      weekStartDate: WEEK, actorUserId: 'manager-1', reason: 'Manager correction request',
    })).rejects.toMatchObject({ code: 'forbidden' });

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(tx.queryOne).toHaveBeenCalledTimes(1);
  });
});

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    active_staff_count: 1, expected_day_count: 6, approved_day_count: 6,
    unapproved_overtime_hours: 0, unapproved_sunday_hours: 0,
    reconciliation_last_succeeded_at: '2026-08-10T01:00:00Z',
    reconciliation_fresh: true, active_lock: false, ...overrides,
  };
}

function managerTxn(): TxnClient {
  return {
    query: vi.fn(async (text: string) =>
      /pg_advisory_xact_lock/i.test(text) ? [{ acquired: '' }] : []),
    queryOne: vi.fn(async (text: string) => /FROM users/i.test(text) ? { role: 'manager' } : null),
    client: {} as TxnClient['client'],
  };
}
