/**
 * A component released at the TOTAL_ONLY tier, as it appears to a reader.
 *
 * The tier publishes the component's ROOT total and nothing else — one value
 * per component means no difference can be taken inside it. From this side that
 * looks like a total with its breakdown missing, and the only wrong answer is
 * to fill the gap: `presence.confirmed_days: 0` beside `scheduled_days: 20`
 * tells a manager nobody turned up, when what happened is that nobody published
 * it.
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
import { NOW, PROJECT, filters, viewer } from './operationsTestFixtures';

beforeEach(() => {
  vi.clearAllMocks();
  resetOperationsMocks(mocks);
});

describe('a month released at the TOTAL_ONLY tier', () => {
  const historic = { start: '2024-01-01', end: '2024-01-31' };

  beforeEach(() => {
    // The tier publishes the component's ROOT and nothing else: one value per
    // component means no difference can be taken inside it.
    aggregateMock.readPublishedAggregates.mockResolvedValue([
      { monthStart: '2024-01-01', dimensionProjectId: PROJECT, metricKey: 'presence.scheduled_days', numerator: 20, denominator: null },
    ]);
  });

  it('renders the total it did publish', async () => {
    const report = await getOperationsAnalytics(filters(historic), viewer, NOW);
    const month = report.series.find((entry) => entry.monthStart === '2024-01-01');
    expect(month?.values.find((v) => v.metricKey === 'presence.scheduled_days')?.numerator).toBe(20);
  });

  it('omits the members it withheld, rather than reporting them as zero', async () => {
    const report = await getOperationsAnalytics(filters(historic), viewer, NOW);
    const month = report.series.find((entry) => entry.monthStart === '2024-01-01');
    expect(month?.values.map((v) => v.metricKey)).toEqual(['presence.scheduled_days']);
    for (const withheld of ['presence.confirmed_days', 'presence.unconfirmed_days', 'presence.vehicle_only_days']) {
      expect(month?.values.some((v) => v.metricKey === withheld)).toBe(false);
    }
  });

  it('fabricates no zero anywhere in the response', async () => {
    // The failure this guards: a reader seeing `confirmed_days: 0` beside
    // `scheduled_days: 20` concludes nobody turned up. Nobody published it.
    const report = await getOperationsAnalytics(filters(historic), viewer, NOW);
    expect(report.cards.filter((card) => card.numerator === 0)).toEqual([]);
    for (const month of report.series) {
      expect(month.values.filter((v) => v.numerator === 0)).toEqual([]);
    }
  });

  it('says why the breakdown is missing', async () => {
    const report = await getOperationsAnalytics(filters(historic), viewer, NOW);
    expect(report.suppressionNotices.join(' ')).toMatch(/without the figures behind it/);
  });

  it('carries no denominator for the total, because there is no population to divide by', async () => {
    const report = await getOperationsAnalytics(filters(historic), viewer, NOW);
    expect(report.cards[0]?.denominator).toBeNull();
  });
});
