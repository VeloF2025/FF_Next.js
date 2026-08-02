import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: { query: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: sqlMock }));

import { runBceaPremium } from '../bceaPremium';
import { runDeptRollup } from '../deptRollup';
import { runGeoMismatch } from '../geoMismatch';
import { runMonthlyTotals } from '../monthlyTotals';
import { runOtTrend } from '../otTrend';
import { runWageCost } from '../wageCost';
import type { ReportInput } from '../types';

const INPUT: ReportInput = {
  scopedStaffIds: null, hasAnyStaff: true, scope: {} as ReportInput['scope'],
  dateFrom: '2026-07-01', dateTo: '2026-07-31', departments: [], siteIds: [],
  staffIdsHint: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  sqlMock.query.mockResolvedValue([]);
});

describe('historical report employment universe', () => {
  it('filters daily-summary reports by employment on each result work date', async () => {
    for (const run of [runMonthlyTotals, runOtTrend, runWageCost, runDeptRollup, runBceaPremium]) {
      await run(INPUT);
      const query = String(sqlMock.query.mock.calls.at(-1)?.[0]);
      expect(query).toContain('s.join_date::date <= ds.work_date');
      expect(query).toContain('s.end_date::date >= ds.work_date');
      expect(query).toContain("LOWER(s.account_status) <> 'pending'");
      expect(query).not.toMatch(/s\.end_date\s+IS\s+NULL\s*(?:AND|$)/i);
    }
  });

  it('filters entry-backed incident reports by employment on the entry work date', async () => {
    await runGeoMismatch(INPUT);
    const query = String(sqlMock.query.mock.calls[0]?.[0]);
    expect(query).toContain('s.join_date::date <= xe.work_date');
    expect(query).toContain('s.end_date::date >= xe.work_date');
    expect(query).toContain("LOWER(s.account_status) <> 'pending'");
  });
});
