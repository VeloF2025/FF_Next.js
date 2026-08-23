/**
 * Month selection and run orchestration.
 *
 * The properties under test are the ones whose failure is silent:
 *
 *   - A month that could not be fully evaluated must NOT be written. Retention
 *     treats stored rows as proof of coverage, so a partial month stored as
 *     complete is a licence to purge incidents the numbers never counted.
 *   - One month failing must not cost the others, or a single bad day freezes
 *     the whole aggregate and blocks every purge.
 *   - Month boundaries are SAST. Deriving them in UTC misfiles the first two
 *     hours of every month.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectiveAnalyticsRetentionSettings: vi.fn(),
  loadProjectsWithOperationalSites: vi.fn(),
  loadPresenceFacts: vi.fn(),
  loadIncidentFacts: vi.fn(),
  loadNotificationFacts: vi.fn(),
  loadMonitorRunFacts: vi.fn(),
  replaceMonth: vi.fn(),
  queryOne: vi.fn(),
  query: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: mocks.query, queryOne: mocks.queryOne }));
vi.mock('../settingsRepository', () => ({
  getEffectiveAnalyticsRetentionSettings: mocks.getEffectiveAnalyticsRetentionSettings,
}));
vi.mock('../presenceFactQueries', () => ({
  loadProjectsWithOperationalSites: mocks.loadProjectsWithOperationalSites,
  loadPresenceFacts: mocks.loadPresenceFacts,
}));
vi.mock('../incidentFactQueries', () => ({
  loadIncidentFacts: mocks.loadIncidentFacts,
  loadNotificationFacts: mocks.loadNotificationFacts,
}));
vi.mock('../monitorFactQueries', () => ({ loadMonitorRunFacts: mocks.loadMonitorRunFacts }));
vi.mock('../aggregateRepository', () => ({
  replaceMonth: mocks.replaceMonth,
  hasCompleteAggregateCoverage: vi.fn(),
}));

import { aggregateOperationsMonths, sastMonthStart, shiftMonth, targetMonths } from '../aggregationService';

const POLICY = {
  metricVersion: 1,
  recalculationWindowMonths: 3,
  anonymityMinContributors: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEffectiveAnalyticsRetentionSettings.mockResolvedValue(POLICY);
  mocks.loadProjectsWithOperationalSites.mockResolvedValue(['p1']);
  mocks.loadPresenceFacts.mockResolvedValue({ facts: [], skippedDays: 0 });
  mocks.loadIncidentFacts.mockResolvedValue([]);
  mocks.loadNotificationFacts.mockResolvedValue([]);
  mocks.loadMonitorRunFacts.mockResolvedValue([]);
  mocks.replaceMonth.mockResolvedValue({ changed: true, rowsWritten: 4 });
  mocks.queryOne.mockResolvedValue({ id: 'run-1' });
  mocks.query.mockResolvedValue([]);
});

describe('month arithmetic', () => {
  it('resolves the SAST month, not the UTC one', () => {
    // 2026-08-01T00:30 SAST is still 2026-07-31 in UTC.
    expect(sastMonthStart('2026-07-31T22:30:00Z')).toBe('2026-08-01');
  });

  it('shifts across a year boundary', () => {
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
  });

  it('walks the window back from the current month, newest first', () => {
    expect(targetMonths('2026-08-23T10:00:00+02:00', 3))
      .toEqual(['2026-08-01', '2026-07-01', '2026-06-01']);
  });

  it('always covers at least the current month', () => {
    expect(targetMonths('2026-08-23T10:00:00+02:00', 0)).toEqual(['2026-08-01']);
  });
});

describe('aggregateOperationsMonths', () => {
  it('rebuilds every month in the window and reports a clean run', async () => {
    const result = await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');

    expect(result.status).toBe('succeeded');
    expect(result.monthsRequested).toBe(3);
    expect(result.monthsSucceeded).toBe(3);
    expect(result.rowsWritten).toBe(12);
    expect(mocks.replaceMonth).toHaveBeenCalledTimes(3);
  });

  it('REFUSES to write a month whose presence evaluation skipped days', async () => {
    mocks.loadPresenceFacts.mockResolvedValue({ facts: [], skippedDays: 2 });

    const result = await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');

    // Nothing stored: a partial month stored as complete would let retention
    // purge incidents the aggregate never counted.
    expect(mocks.replaceMonth).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect(result.monthsFailed).toBe(3);
  });

  it('lets the other months through when one fails', async () => {
    mocks.replaceMonth
      .mockRejectedValueOnce(new Error('source outage'))
      .mockResolvedValue({ changed: true, rowsWritten: 4 });

    const result = await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');

    expect(result.status).toBe('partial');
    expect(result.monthsSucceeded).toBe(2);
    expect(result.monthsFailed).toBe(1);
  });

  it('records an unchanged month as a success that wrote nothing', async () => {
    mocks.replaceMonth.mockResolvedValue({ changed: false, rowsWritten: 0 });

    const result = await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');

    expect(result.status).toBe('succeeded');
    expect(result.monthsUnchanged).toBe(3);
    expect(result.rowsWritten).toBe(0);
  });

  it('opens a run before doing work and closes it with the outcome', async () => {
    mocks.replaceMonth.mockRejectedValue(new Error('nope'));

    await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');

    const finish = mocks.query.mock.calls.find(([sql]) => String(sql).includes('runs:finish'));
    expect(finish).toBeDefined();
    expect(finish?.[1]).toEqual(['run-1', 'failed', 0, 3, 0, 'month_aggregation_failed']);
  });

  it('passes the configured anonymity threshold through, not a hardcoded five', async () => {
    // SIX contributors: enough to clear a threshold of five, not enough to
    // clear nine. A smaller group would be withheld under both and the test
    // would pass no matter which number the service actually used.
    const sixPeople = Array.from({ length: 6 }, (_, i) => ({
      kind: 'presence' as const, workDate: '2026-08-03',
      dimension: { projectId: 'p1', operationalSiteId: 's1' },
      contributorKey: `staff-${i}`, confirmation: 'confirmed' as const,
    }));
    mocks.loadPresenceFacts.mockResolvedValue({ facts: sixPeople, skippedDays: 0 });

    // Baseline: at five, this group is publishable.
    await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');
    const atFive = mocks.replaceMonth.mock.calls[0]?.[2] ?? [];
    expect(atFive.length).toBeGreaterThan(0);

    mocks.replaceMonth.mockClear();
    mocks.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ ...POLICY, anonymityMinContributors: 9 });

    await aggregateOperationsMonths('2026-08-23T01:00:00+02:00');
    const atNine = mocks.replaceMonth.mock.calls[0]?.[2] ?? [];
    expect(atNine).toEqual([]);
  });
});
