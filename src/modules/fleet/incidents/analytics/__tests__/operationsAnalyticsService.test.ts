import { beforeEach, describe, expect, it, vi } from 'vitest';

const scopeMock = vi.hoisted(() => ({ resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn() }));
vi.mock('../../reviewScope', () => scopeMock);

const settingsMock = vi.hoisted(() => ({ getEffectiveAnalyticsRetentionSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsMock);

const factsMock = vi.hoisted(() => ({ loadIncidentFacts: vi.fn(), loadNotificationFacts: vi.fn() }));
vi.mock('../incidentFactQueries', () => factsMock);

const monitorMock = vi.hoisted(() => ({ loadMonitorRunFacts: vi.fn() }));
vi.mock('../monitorFactQueries', () => monitorMock);

const presenceMock = vi.hoisted(() => ({
  loadPresenceFacts: vi.fn(), loadProjectsWithOperationalSites: vi.fn(),
}));
vi.mock('../presenceFactQueries', () => presenceMock);

const aggregateMock = vi.hoisted(() => ({ readPublishedAggregates: vi.fn() }));
vi.mock('../operationsAggregateQueries', () => aggregateMock);

const runMock = vi.hoisted(() => ({
  latestAggregationRun: vi.fn(), listScopedProjectIds: vi.fn(), projectIdForOperationalSite: vi.fn(),
}));
vi.mock('../operationsRunQueries', () => runMock);

const mocks = {
  scope: scopeMock, settings: settingsMock, facts: factsMock, monitor: monitorMock,
  presence: presenceMock, aggregates: aggregateMock, runs: runMock,
};

import { OperationsAccessDeniedError, getOperationsAnalytics } from '../operationsAnalyticsService';
import { resetOperationsMocks } from './operationsMocks';
import {
  NOW, OTHER_PROJECT, PROJECT, RETAINED_FROM, SITE, filters, incident, viewer,
} from './operationsTestFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  resetOperationsMocks(mocks);
});

describe('scope', () => {
  it('refuses a viewer without the incidents permission', async () => {
    scopeMock.resolveIncidentScope.mockResolvedValue(null);
    await expect(getOperationsAnalytics(filters(), viewer, NOW)).rejects.toThrow(OperationsAccessDeniedError);
  });

  it('refuses a project the viewer does not manage', async () => {
    scopeMock.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getOperationsAnalytics(filters({ projectId: OTHER_PROJECT }), viewer, NOW))
      .rejects.toThrow(/cannot view analytics for that project/);
  });

  it('refuses a site whose project the viewer does not manage', async () => {
    // Not an empty chart: "nothing happened there" and "not yours" are
    // different answers, and only one of them is true.
    runMock.projectIdForOperationalSite.mockResolvedValue(OTHER_PROJECT);
    scopeMock.isProjectOwnedByScope.mockResolvedValue(false);
    await expect(getOperationsAnalytics(filters({ operationalSiteId: SITE }), viewer, NOW))
      .rejects.toThrow(/cannot view analytics for that site/);
  });

  it('refuses a site that does not exist rather than reporting zero for it', async () => {
    runMock.projectIdForOperationalSite.mockResolvedValue(null);
    await expect(getOperationsAnalytics(filters({ operationalSiteId: SITE }), viewer, NOW))
      .rejects.toThrow(OperationsAccessDeniedError);
  });

  it('drops a fact from a project outside the viewer scope', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident(), incident({ incidentId: 'bbbb', dimension: { projectId: OTHER_PROJECT, operationalSiteId: SITE } }),
    ]);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.cards.find((card) => card.metricKey === 'incident.late')?.numerator).toBe(1);
  });

  it('does not enumerate projects for an unrestricted viewer', async () => {
    scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: PROJECT, pmStaffId: null });
    await getOperationsAnalytics(filters(), viewer, NOW);
    expect(runMock.listScopedProjectIds).not.toHaveBeenCalled();
  });
});

describe('the retention boundary', () => {
  it('starts at the first month the day-by-day purge has not touched', async () => {
    // retentionService deletes work_date < 2025-08-24, so August 2025 is half
    // gone. Deriving it live would report twenty-three missing days as zero.
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.retainedDetailFrom).toBe(RETAINED_FROM);
  });

  it('keeps the boundary month itself on the retained side', async () => {
    factsMock.loadIncidentFacts.mockImplementation(async (monthStart: string) => (
      monthStart === RETAINED_FROM ? [incident({ workDate: '2025-09-10' })] : []
    ));
    const report = await getOperationsAnalytics(filters({ start: RETAINED_FROM, end: '2025-09-30' }), viewer, NOW);
    expect(factsMock.loadIncidentFacts).toHaveBeenCalledWith(RETAINED_FROM, '2025-10-01', expect.anything());
    expect(report.series[0]?.values.find((v) => v.metricKey === 'incident.late')?.numerator).toBe(1);
  });

  it('reads the half-purged month from the aggregates instead', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2025-08-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 9, denominator: null, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2025-08-01', end: '2025-08-31' }), viewer, NOW);
    expect(factsMock.loadIncidentFacts).not.toHaveBeenCalled();
    expect(report.series[0]?.values.find((v) => v.metricKey === 'incident.late')?.numerator).toBe(9);
  });

  it('lands on the cutoff month itself when the cutoff is a first of the month', async () => {
    // 22:30 UTC on the last of August is already the 1st of September in SAST,
    // so the cutoff is 2025-09-01 exactly and no month is half purged.
    const report = await getOperationsAnalytics(
      filters({ start: '2026-09-01', end: '2026-09-30' }), viewer, '2026-08-31T22:30:00.000Z',
    );
    expect(report.retainedDetailFrom).toBe('2025-09-01');
  });
});

describe('the retained / historic split', () => {
  it('derives a recent month from facts and never asks the aggregates for it', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    await getOperationsAnalytics(filters(), viewer, NOW);
    expect(factsMock.loadIncidentFacts).toHaveBeenCalledWith('2026-08-01', '2026-09-01', expect.anything());
    expect(aggregateMock.readPublishedAggregates).toHaveBeenCalledWith(
      expect.objectContaining({ monthStarts: [] }), expect.anything(),
    );
  });

  it('reads an old month from the aggregates and never from facts', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-03-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 7, denominator: 20, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-03-01', end: '2024-03-31' }), viewer, NOW);
    expect(factsMock.loadIncidentFacts).not.toHaveBeenCalled();
    expect(report.cards).toEqual([
      { metricKey: 'incident.late', numerator: 7, denominator: 20, histogram: null, generalized: false },
    ]);
  });

  it('takes each month from exactly one source, so nothing is counted twice', async () => {
    factsMock.loadIncidentFacts.mockImplementation(async (monthStart: string) => (
      monthStart === '2026-08-01' ? [incident({ workDate: '2026-08-10' })] : []
    ));
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2025-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 4, denominator: null, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2025-01-01', end: '2026-08-31' }), viewer, NOW);
    const january = report.series.find((month) => month.monthStart === '2025-01-01');
    const august = report.series.find((month) => month.monthStart === '2026-08-01');
    expect(january?.values.find((v) => v.metricKey === 'incident.late')?.numerator).toBe(4);
    expect(august?.values.find((v) => v.metricKey === 'incident.late')?.numerator).toBe(1);
    expect(report.cards.find((card) => card.metricKey === 'incident.late')?.numerator).toBe(5);
  });
});

describe('folding months into cards', () => {
  it('sums numerators and denominators rather than averaging percentages', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'outcome.false_positive', numerator: 1, denominator: 100, histogram: null, generalized: false },
      { monthStart: '2024-02-01', dimensionProjectId: PROJECT, metricKey: 'outcome.false_positive', numerator: 1, denominator: 2, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-02-29' }), viewer, NOW);
    const card = report.cards.find((c) => c.metricKey === 'outcome.false_positive');
    // 2/102, not the mean of 1% and 50%.
    expect(card?.numerator).toBe(2);
    expect(card?.denominator).toBe(102);
  });

  it('merges histograms bucket by bucket', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'timing.acknowledgement', numerator: 0, denominator: null, histogram: { sampleCount: 2, sumSeconds: 300, buckets: [2, 0, 0, 0, 0, 0] }, generalized: false },
      { monthStart: '2024-02-01', dimensionProjectId: PROJECT, metricKey: 'timing.acknowledgement', numerator: 0, denominator: null, histogram: { sampleCount: 3, sumSeconds: 900, buckets: [0, 3, 0, 0, 0, 0] }, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-02-29' }), viewer, NOW);
    expect(report.cards.find((c) => c.metricKey === 'timing.acknowledgement')?.histogram)
      .toEqual({ sampleCount: 5, sumSeconds: 1200, buckets: [2, 3, 0, 0, 0, 0] });
  });

  it('marks a card generalized when any month behind it was', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: false },
      { monthStart: '2024-02-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: true },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-02-29' }), viewer, NOW);
    expect(report.cards.find((c) => c.metricKey === 'incident.late')?.generalized).toBe(true);
  });

  it('reports every month in the range, including one with nothing in it', async () => {
    const report = await getOperationsAnalytics(filters({ start: '2026-06-01', end: '2026-08-31' }), viewer, NOW);
    expect(report.series.map((month) => month.monthStart)).toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
    expect(report.series[0]?.values).toEqual([]);
  });
});

describe('suppression notices and freshness', () => {
  it('says when a figure describes a wider group than was asked for', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: true },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/wider group/);
  });

  it('says when historic months returned nothing at all', async () => {
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/No published figures/);
  });

  it('adds no notice when nothing was suppressed', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.suppressionNotices).toEqual([]);
  });

  it('says how many managed projects the historic half actually covered', async () => {
    runMock.listScopedProjectIds.mockResolvedValue([PROJECT, OTHER_PROJECT]);
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/1 of the 2 projects/);
  });

  it('adds no such notice when every project published', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).not.toMatch(/projects/);
  });

  it('reports freshness for the metric version the numbers were built under', async () => {
    settingsMock.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ retentionMonths: 12, metricVersion: 3 });
    runMock.latestAggregationRun.mockResolvedValue({ status: 'partial', aggregatesThrough: '2026-06-01' });
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(runMock.latestAggregationRun).toHaveBeenCalledWith(3);
    expect(report.freshness).toEqual({ aggregatesThrough: '2026-06-01', lastRunStatus: 'partial' });
  });

  it('reports nulls when the pipeline has never run, not a confident zero', async () => {
    runMock.latestAggregationRun.mockResolvedValue(null);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.freshness).toEqual({ aggregatesThrough: null, lastRunStatus: null });
  });
});

describe('what never reaches the response', () => {
  it('serializes no driver, vehicle, coordinate, or prose field', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    const body = JSON.stringify(await getOperationsAnalytics(filters(), viewer, NOW));
    for (const forbidden of ['contributorKey', 'vehicleId', 'incidentId', 'latitude', 'longitude', 'note', 'storageUrl']) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('ranks nothing by driver — a card names a metric, never a person', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident({ incidentId: '1', contributorKey: 'driver-a' }),
      incident({ incidentId: '2', contributorKey: 'driver-b' }),
    ]);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.cards.every((card) => card.metricKey.includes('.'))).toBe(true);
    expect(JSON.stringify(report)).not.toContain('driver-a');
  });
});
