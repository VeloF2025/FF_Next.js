/**
 * The sentences the response says about itself.
 *
 * A notice is the only thing standing between a partial figure and a reader who
 * takes it for a total, so each one is pinned to the shape that produces it
 * rather than to a substring of prose.
 */
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

import { getOperationsAnalytics } from '../operationsAnalyticsService';
import { resetOperationsMocks } from './operationsMocks';
import { NOW, OTHER_PROJECT, PROJECT, filters, incident, viewer } from './operationsTestFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  resetOperationsMocks(mocks);
});

describe('suppression notices and freshness', () => {
  it('says when a total came back without the figures behind it', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'presence.scheduled_days', numerator: 20, denominator: null },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/without the figures behind it/);
  });

  it('adds no such notice when the whole component came back', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'presence.scheduled_days', numerator: 20, denominator: null },
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'presence.confirmed_days', numerator: 18, denominator: 20 },
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'presence.unconfirmed_days', numerator: 1, denominator: 20 },
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'presence.vehicle_only_days', numerator: 1, denominator: 20 },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).not.toMatch(/without the figures behind it/);
  });

  it('names every group a purged month published nothing for', async () => {
    // Nothing at all came back, so every component is at the NONE tier and each
    // is named. A single "no figures" sentence for the range would leave a
    // reader unable to tell which cards are short.
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    const notices = report.suppressionNotices.join(' ');
    expect(notices).toMatch(/No figures were published for the presence.scheduled_days group in 2024-01-01/);
    expect(notices).toMatch(/No figures were published for the incident.total group in 2024-01-01/);
  });

  it('adds no notice when nothing was suppressed', async () => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.suppressionNotices).toEqual([]);
  });

  it('names the month that is short of the projects the viewer manages', async () => {
    runMock.listScopedProjectIds.mockResolvedValue([PROJECT, OTHER_PROJECT]);
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/2024-01-01 \(1 of 2\)/);
  });

  it('counts project coverage per month, not over the union of them', async () => {
    // June published both projects and July only one. Over the union both
    // appear, and July's total — short one project — passes without a word.
    runMock.listScopedProjectIds.mockResolvedValue([PROJECT, OTHER_PROJECT]);
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-06-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null },
      { monthStart: '2024-06-01', dimensionProjectId: OTHER_PROJECT, metricKey: 'incident.late', numerator: 3, denominator: null },
      { monthStart: '2024-07-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 4, denominator: null },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-06-01', end: '2024-07-31' }), viewer, NOW);
    const notices = report.suppressionNotices.join(' ');
    expect(notices).toMatch(/2024-07-01 \(1 of 2\)/);
    expect(notices).not.toMatch(/2024-06-01 \(/);
  });

  it('adds no such notice when every project published', async () => {
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'incident.late', numerator: 5, denominator: null },
    ]);
    const report = await getOperationsAnalytics(filters({ start: '2024-01-01', end: '2024-01-31' }), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).not.toMatch(/projects you manage/);
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
