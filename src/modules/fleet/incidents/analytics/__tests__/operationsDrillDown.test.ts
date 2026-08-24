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

import {
  OperationsFilterConflictError, getOperationsAnalytics, getOperationsDrillDown,
} from '../operationsAnalyticsService';
import { resetOperationsMocks } from './operationsMocks';
import {
  DRIVER, MANAGER, NOW, OTHER_PROJECT, PROJECT, RETAINED_FROM, SITE, USER,
  filters, incident, viewer,
} from './operationsTestFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  resetOperationsMocks(mocks);
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
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 9, denominator: null, histogram: null, generalized: false },
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

describe('a drill-down over a range that straddles the boundary', () => {
  const straddling = { start: '2025-07-01', end: '2026-08-31' };

  it('refuses it rather than answering only the half that still exists', async () => {
    await expect(getOperationsDrillDown(filters(straddling), viewer, {}, NOW))
      .rejects.toThrow(OperationsFilterConflictError);
  });

  it('names the boundary that splits the range', async () => {
    await expect(getOperationsDrillDown(filters(straddling), viewer, {}, NOW))
      .rejects.toThrow(new RegExp(RETAINED_FROM));
  });

  it('refuses a retained-only filter over that range in the words analytics uses', async () => {
    const withDriver = filters({ ...straddling, staffId: DRIVER });
    const fromAnalytics = await getOperationsAnalytics(withDriver, viewer, NOW).catch((e: Error) => e.message);
    const fromDrillDown = await getOperationsDrillDown(withDriver, viewer, {}, NOW).catch((e: Error) => e.message);
    expect(fromDrillDown).toBe(fromAnalytics);
  });

  it('still answers a range wholly inside the retained window', async () => {
    const page = await getOperationsDrillDown(filters({ start: '2026-07-01', end: '2026-08-31' }), viewer, {}, NOW);
    expect(page.mode).toBe('retained_detail');
  });
});

describe('the filters an aggregate cannot answer', () => {
  const historic = { start: '2024-01-01', end: '2024-01-31' };

  it.each([
    ['op_driver', { staffId: DRIVER }],
    ['op_vehicle', { vehicleId: DRIVER }],
    ['op_type', { incidentType: 'late' }],
    ['op_severity', { severity: 'high' }],
    ['op_outcome', { outcome: 'confirmed' }],
    ['op_evidence', { evidenceAvailable: true }],
  ])('refuses %s over a purged month rather than dropping it', async (name, overrides) => {
    // An aggregate row has a project and a site and nothing else. Applying any
    // of these to it would widen the answer without saying so.
    await expect(getOperationsAnalytics(filters({ ...historic, ...overrides }), viewer, NOW))
      .rejects.toThrow(new RegExp(name));
  });

  it.each([
    ['op_type', { incidentType: 'late' }],
    ['op_severity', { severity: 'high' }],
    ['op_evidence', { evidenceAvailable: false }],
  ])('allows %s entirely inside the retained window', async (_name, overrides) => {
    const report = await getOperationsAnalytics(filters(overrides), viewer, NOW);
    expect(report.suppressionNotices).toEqual([]);
  });

  it('never passes one of them to an aggregate query', async () => {
    await getOperationsAnalytics(filters({ staffId: DRIVER }), viewer, NOW);
    for (const call of aggregateMock.readPublishedAggregates.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(DRIVER);
    }
  });
});

describe('op_manager', () => {
  beforeEach(() => {
    runMock.listScopedProjectIds.mockImplementation(async (scope: { pmUserId: string }) => (
      scope.pmUserId === MANAGER ? [PROJECT] : [PROJECT, OTHER_PROJECT]
    ));
    scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: USER, pmStaffId: null });
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

describe('a site read together with a project', () => {
  it('asks the aggregates for both, not for the site alone', async () => {
    await getOperationsAnalytics(
      filters({ start: '2024-01-01', end: '2024-01-31', projectId: PROJECT, operationalSiteId: SITE }),
      viewer, NOW,
    );
    expect(aggregateMock.readPublishedAggregates).toHaveBeenCalledWith(
      expect.objectContaining({ operationalSiteId: SITE, projectId: PROJECT }), expect.anything(),
    );
  });
});
