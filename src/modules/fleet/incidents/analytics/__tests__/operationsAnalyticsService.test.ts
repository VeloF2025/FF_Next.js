import { beforeEach, describe, expect, it, vi } from 'vitest';

const scopeMock = vi.hoisted(() => ({ resolveIncidentScope: vi.fn(), isProjectOwnedByScope: vi.fn() }));
vi.mock('../../reviewScope', () => scopeMock);

const settingsMock = vi.hoisted(() => ({ getEffectiveAnalyticsRetentionSettings: vi.fn() }));
vi.mock('../settingsRepository', () => settingsMock);

const factsMock = vi.hoisted(() => ({ loadIncidentFacts: vi.fn(), loadNotificationFacts: vi.fn() }));
vi.mock('../incidentFactQueries', () => factsMock);

const aggregateMock = vi.hoisted(() => ({ readPublishedAggregates: vi.fn() }));
vi.mock('../operationsAggregateQueries', () => aggregateMock);

const runMock = vi.hoisted(() => ({ latestAggregationRun: vi.fn(), listScopedProjectIds: vi.fn() }));
vi.mock('../operationsRunQueries', () => runMock);

import {
  OperationsAccessDeniedError, OperationsFilterConflictError,
  getOperationsAnalytics, getOperationsDrillDown,
} from '../operationsAnalyticsService';
import type { IncidentFact } from '../facts';
import type { OperationsFilters } from '../types';

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT = '44444444-4444-4444-8444-444444444444';
const SITE = '55555555-5555-4555-8555-555555555555';
const DRIVER = '66666666-6666-4666-8666-666666666666';
const MANAGER = '77777777-7777-4777-8777-777777777777';

const viewer = { userId: USER, staffId: STAFF, role: 'project_manager' };
/** 2026-08-24, with a 12-month retention: months from 2025-08-01 keep detail. */
const NOW = '2026-08-24T09:00:00.000Z';

function incident(overrides: Partial<IncidentFact> = {}): IncidentFact {
  return {
    kind: 'incident', workDate: '2026-08-10',
    dimension: { projectId: PROJECT, operationalSiteId: SITE },
    contributorKey: DRIVER, incidentId: 'aaaaaaa1-0000-4000-8000-000000000001',
    severity: 'high', vehicleId: null, incidentType: 'late', outcome: 'confirmed',
    acknowledgementSeconds: 120, reviewStartSeconds: null, resolutionSeconds: null,
    driverResponseSeconds: null, driverInputRequested: false, driverInputResponded: false,
    driverInputOnTime: false, evidenceAvailable: true, isRecurrence: false,
    ...overrides,
  };
}

function filters(overrides: Partial<OperationsFilters> = {}): OperationsFilters {
  return { start: '2026-08-01', end: '2026-08-31', ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: false, pmUserId: USER, pmStaffId: STAFF });
  scopeMock.isProjectOwnedByScope.mockResolvedValue(true);
  settingsMock.getEffectiveAnalyticsRetentionSettings.mockResolvedValue({ retentionMonths: 12, metricVersion: 1 });
  factsMock.loadIncidentFacts.mockResolvedValue([]);
  factsMock.loadNotificationFacts.mockResolvedValue([]);
  aggregateMock.readPublishedAggregates.mockResolvedValue([]);
  runMock.latestAggregationRun.mockResolvedValue({ status: 'succeeded', aggregatesThrough: '2026-07-01' });
  runMock.listScopedProjectIds.mockResolvedValue([PROJECT]);
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

  it('drops a fact from a project outside the viewer scope', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident(), incident({ incidentId: 'bbbb', dimension: { projectId: OTHER_PROJECT, operationalSiteId: SITE } }),
    ]);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    const late = report.cards.find((card) => card.metricKey === 'incident.late');
    expect(late?.numerator).toBe(1);
  });

  it('does not enumerate projects for an unrestricted viewer', async () => {
    scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: USER, pmStaffId: STAFF });
    await getOperationsAnalytics(filters(), viewer, NOW);
    expect(runMock.listScopedProjectIds).not.toHaveBeenCalled();
  });
});

describe('the retained / historic split', () => {
  it('reports the retention boundary it split on', async () => {
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.retainedDetailFrom).toBe('2025-08-01');
  });

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
      { monthStart: '2024-03-01', metricKey: 'incident.late', numerator: 7, denominator: 20, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-03-01', end: '2024-03-31' }), viewer, NOW);
    expect(factsMock.loadIncidentFacts).not.toHaveBeenCalled();
    expect(report.cards).toEqual([
      { metricKey: 'incident.late', numerator: 7, denominator: 20, histogram: null, generalized: false },
    ]);
  });

  it('takes each month from exactly one source, so nothing is counted twice', async () => {
    // A range spanning the boundary: the retained month comes from facts, the
    // historic one from aggregates, and neither contributes to the other.
    // The mock answers per month, as the real loader does — a flat
    // mockResolvedValue would hand the same incident to all thirteen retained
    // months and inflate the total thirteenfold.
    factsMock.loadIncidentFacts.mockImplementation(async (monthStart: string) => (
      monthStart === '2026-08-01' ? [incident({ workDate: '2026-08-10' })] : []
    ));
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2025-01-01', metricKey: 'incident.late', numerator: 4, denominator: null, histogram: null, generalized: false },
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
      { monthStart: '2024-01-01', metricKey: 'outcome.false_positive', numerator: 1, denominator: 100, histogram: null, generalized: false },
      { monthStart: '2024-02-01', metricKey: 'outcome.false_positive', numerator: 1, denominator: 2, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-02-29' }), viewer, NOW);
    const card = report.cards.find((c) => c.metricKey === 'outcome.false_positive');
    // 2/102, not the mean of 1% and 50%.
    expect(card?.numerator).toBe(2);
    expect(card?.denominator).toBe(102);
  });

  it('merges histograms bucket by bucket', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', metricKey: 'timing.acknowledgement', numerator: 0, denominator: null, histogram: { sampleCount: 2, sumSeconds: 300, buckets: [2, 0, 0, 0, 0, 0] }, generalized: false },
      { monthStart: '2024-02-01', metricKey: 'timing.acknowledgement', numerator: 0, denominator: null, histogram: { sampleCount: 3, sumSeconds: 900, buckets: [0, 3, 0, 0, 0, 0] }, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-02-29' }), viewer, NOW);
    const card = report.cards.find((c) => c.metricKey === 'timing.acknowledgement');
    expect(card?.histogram).toEqual({ sampleCount: 5, sumSeconds: 1200, buckets: [2, 3, 0, 0, 0, 0] });
  });

  it('marks a card generalized when any month behind it was', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: false },
      { monthStart: '2024-02-01', metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: true },
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

describe('the retained-only filters', () => {
  it('refuses a driver filter over a range that reaches past the boundary', async () => {
    await expect(getOperationsAnalytics(filters({ start: '2024-01-01', end: '2026-08-31', staffId: DRIVER }), viewer, NOW))
      .rejects.toThrow(OperationsFilterConflictError);
  });

  it('allows a driver filter entirely within the retained window', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident(), incident({ incidentId: 'other', contributorKey: 'someone-else' })]);
    const report = await getOperationsAnalytics(filters({ staffId: DRIVER }), viewer, NOW);
    expect(report.cards.find((c) => c.metricKey === 'incident.late')?.numerator).toBe(1);
  });

  it('never passes a driver or vehicle filter to an aggregate query', async () => {
    await getOperationsAnalytics(filters({ staffId: DRIVER }), viewer, NOW);
    for (const call of aggregateMock.readPublishedAggregates.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(DRIVER);
    }
  });
});

describe('suppression notices and freshness', () => {
  it('says when a figure describes a wider group than was asked for', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: true },
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

  it('reports pipeline freshness rather than implying the numbers are current', async () => {
    runMock.latestAggregationRun.mockResolvedValue({ status: 'partial', aggregatesThrough: '2026-06-01' });
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.freshness).toEqual({ aggregatesThrough: '2026-06-01', lastRunStatus: 'partial' });
  });

  it('reports nulls when the pipeline has never run, not a confident zero', async () => {
    runMock.latestAggregationRun.mockResolvedValue(null);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.freshness).toEqual({ aggregatesThrough: null, lastRunStatus: null });
  });
});

describe('drill-down', () => {
  it('returns the incident ids for a retained range', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident({ incidentId: 'bbbb' }), incident({ incidentId: 'aaaa' }),
    ]);
    const page = await getOperationsDrillDown(filters(), viewer, {}, NOW);
    expect(page.mode).toBe('retained_detail');
    expect(page.incidentIds).toEqual(['aaaa', 'bbbb']);
  });

  it('answers aggregate_only for a purged range, with values and no ids', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', metricKey: 'incident.late', numerator: 9, denominator: null, histogram: null, generalized: false },
    ]);
    const page = await getOperationsDrillDown(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, {}, NOW);
    expect(page.mode).toBe('aggregate_only');
    expect(page.incidentIds).toEqual([]);
    expect(page.values.find((v) => v.metricKey === 'incident.late')?.numerator).toBe(9);
  });

  it('refuses a driver filter in aggregate_only rather than silently ignoring it', async () => {
    await expect(getOperationsDrillDown(filters({ start: '2024-01-01', end: '2024-01-31', staffId: DRIVER }), viewer, {}, NOW))
      .rejects.toThrow(OperationsFilterConflictError);
  });

  it('deduplicates an incident that produced more than one fact', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident({ incidentId: 'same' }), incident({ incidentId: 'same' })]);
    const page = await getOperationsDrillDown(filters(), viewer, {}, NOW);
    expect(page.incidentIds).toEqual(['same']);
  });

  it('resumes after a cursor rather than by offset', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident({ incidentId: 'a' }), incident({ incidentId: 'b' }), incident({ incidentId: 'c' }),
    ]);
    const page = await getOperationsDrillDown(filters(), viewer, { cursor: 'a' }, NOW);
    expect(page.incidentIds).toEqual(['b', 'c']);
  });

  it('never returns an id outside the viewer scope', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident({ incidentId: 'mine' }),
      incident({ incidentId: 'theirs', dimension: { projectId: OTHER_PROJECT, operationalSiteId: SITE } }),
    ]);
    const page = await getOperationsDrillDown(filters(), viewer, {}, NOW);
    expect(page.incidentIds).toEqual(['mine']);
  });
});

describe('what never reaches the response', () => {
  it('serializes no driver, vehicle, coordinate, or prose field', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    const body = JSON.stringify(report);
    expect(body).not.toContain(DRIVER);
    expect(body).not.toContain('contributorKey');
    expect(body).not.toContain('vehicleId');
    expect(body).not.toContain('incidentId');
    for (const forbidden of ['latitude', 'longitude', 'note', 'storageUrl']) {
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

describe('the SAST retention boundary', () => {
  it('reads the boundary in Johannesburg, not in UTC', async () => {
    // 22:30 UTC on the last of August is already the 1st of September in SAST,
    // so the twelve retained months run back to September, not to August. A UTC
    // reading leaves a month whose detail was already purged classed as
    // retained, and it then reports zero from facts that no longer exist.
    const report = await getOperationsAnalytics(
      filters({ start: '2026-09-01', end: '2026-09-30' }), viewer, '2026-08-31T22:30:00.000Z',
    );
    expect(report.retainedDetailFrom).toBe('2025-09-01');
  });

  it('still reads a mid-month instant as that month', async () => {
    const report = await getOperationsAnalytics(filters(), viewer, '2026-08-24T09:00:00.000Z');
    expect(report.retainedDetailFrom).toBe('2025-08-01');
  });
});

describe('op_manager', () => {
  beforeEach(() => {
    runMock.listScopedProjectIds.mockImplementation(async (scope: { pmUserId: string }) => (
      scope.pmUserId === MANAGER ? [PROJECT] : [PROJECT, OTHER_PROJECT]
    ));
    scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: USER, pmStaffId: STAFF });
  });

  it('drops a live fact from a project the named manager does not own', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident(),
      incident({ incidentId: 'theirs', dimension: { projectId: OTHER_PROJECT, operationalSiteId: SITE } }),
    ]);
    const report = await getOperationsAnalytics(filters({ managerUserId: MANAGER }), viewer, NOW);
    expect(report.cards.find((card) => card.metricKey === 'incident.late')?.numerator).toBe(1);
  });

  it('narrows the aggregate half to the same projects', async () => {
    await getOperationsAnalytics(
      filters({ start: '2024-01-01', end: '2024-01-31', managerUserId: MANAGER }), viewer, NOW,
    );
    expect(aggregateMock.readPublishedAggregates).toHaveBeenCalledWith(
      expect.objectContaining({ projectIds: [PROJECT] }), expect.anything(),
    );
  });

  it('drops every live fact when the asked-for project is not one of theirs', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    const report = await getOperationsAnalytics(
      filters({ projectId: OTHER_PROJECT, managerUserId: MANAGER }), viewer, NOW,
    );
    expect(report.cards).toEqual([]);
  });

  it('does not ask the aggregates about a project that manager does not own', async () => {
    await getOperationsAnalytics(
      filters({ start: '2024-01-01', end: '2024-01-31', projectId: OTHER_PROJECT, managerUserId: MANAGER }),
      viewer, NOW,
    );
    expect(aggregateMock.readPublishedAggregates).not.toHaveBeenCalled();
  });

  it('applies to the drill-down by the same rule', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([
      incident({ incidentId: 'mine' }),
      incident({ incidentId: 'theirs', dimension: { projectId: OTHER_PROJECT, operationalSiteId: SITE } }),
    ]);
    const page = await getOperationsDrillDown(filters({ managerUserId: MANAGER }), viewer, {}, NOW);
    expect(page.incidentIds).toEqual(['mine']);
  });
});

describe('a drill-down over a range that straddles the boundary', () => {
  it('refuses it rather than answering only the half that still exists', async () => {
    await expect(getOperationsDrillDown(filters({ start: '2025-07-01', end: '2026-08-31' }), viewer, {}, NOW))
      .rejects.toThrow(OperationsFilterConflictError);
  });

  it('names the boundary that splits the range', async () => {
    await expect(getOperationsDrillDown(filters({ start: '2025-07-01', end: '2026-08-31' }), viewer, {}, NOW))
      .rejects.toThrow(/2025-08-01/);
  });

  it('refuses a driver filter over that range with the message analytics uses', async () => {
    const straddling = filters({ start: '2025-07-01', end: '2026-08-31', staffId: DRIVER });
    const fromAnalytics = await getOperationsAnalytics(straddling, viewer, NOW).catch((e: Error) => e.message);
    const fromDrillDown = await getOperationsDrillDown(straddling, viewer, {}, NOW).catch((e: Error) => e.message);
    expect(fromDrillDown).toBe(fromAnalytics);
  });

  it('still answers a range wholly inside the retained window', async () => {
    const page = await getOperationsDrillDown(filters({ start: '2026-07-01', end: '2026-08-31' }), viewer, {}, NOW);
    expect(page.mode).toBe('retained_detail');
  });
});

describe('a restricted viewer whose projects did not all publish', () => {
  it('says so rather than presenting the total as complete', async () => {
    runMock.listScopedProjectIds.mockResolvedValue([PROJECT, OTHER_PROJECT]);
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/1 of the 2 projects/);
  });

  it('adds no such notice when every project published', async () => {
    runMock.listScopedProjectIds.mockResolvedValue([PROJECT]);
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null, histogram: null, generalized: false },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).not.toMatch(/projects/);
  });
});
