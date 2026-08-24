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

import { MONTH_LOAD_CONCURRENCY } from '../operationsFactSelection';
import { getOperationsAnalytics } from '../operationsAnalyticsService';
import { resetOperationsMocks } from './operationsMocks';
import {
  NOW, PROJECT, SITE, filters, incident, monitorRun, notification, presence, viewer,
} from './operationsTestFixtures';

function keysOf(cards: readonly { metricKey: string }[]): string[] {
  return cards.map((card) => card.metricKey);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetOperationsMocks(mocks);
});

describe('every fact kind the nightly job uses', () => {
  beforeEach(() => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
    factsMock.loadNotificationFacts.mockResolvedValue([notification(), notification({ delivered: false })]);
    monitorMock.loadMonitorRunFacts.mockResolvedValue([monitorRun()]);
    presenceMock.loadPresenceFacts.mockResolvedValue({
      facts: [presence(), presence({ contributorKey: 'someone-else', confirmation: 'unconfirmed' })],
      skippedDays: 0,
    });
  });

  it('reports presence from presence facts, not as a confident zero', async () => {
    // Loading only incidents does not shrink the answer: the calculator emits
    // every key, so a missing fact kind comes back as 0 for a fully staffed site.
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.cards.find((c) => c.metricKey === 'presence.scheduled_days')?.numerator).toBe(2);
    expect(report.cards.find((c) => c.metricKey === 'presence.confirmed_days')?.numerator).toBe(1);
  });

  it('reports monitor-run and notification reliability from their own facts', async () => {
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(report.cards.find((c) => c.metricKey === 'reliability.monitor_runs_expected')?.numerator).toBe(1);
    expect(report.cards.find((c) => c.metricKey === 'reliability.notifications_sent')?.numerator).toBe(2);
    expect(report.cards.find((c) => c.metricKey === 'reliability.notifications_delivered')?.numerator).toBe(1);
  });

  it('evaluates presence only for the projects in scope', async () => {
    await getOperationsAnalytics(filters(), viewer, NOW);
    expect(presenceMock.loadPresenceFacts).toHaveBeenCalledWith('2026-08-01', [PROJECT]);
    expect(presenceMock.loadProjectsWithOperationalSites).not.toHaveBeenCalled();
  });

  it('falls back to every project with a site when nothing narrows the request', async () => {
    scopeMock.resolveIncidentScope.mockResolvedValue({ unrestricted: true, pmUserId: PROJECT, pmStaffId: null });
    await getOperationsAnalytics(filters(), viewer, NOW);
    expect(presenceMock.loadProjectsWithOperationalSites).toHaveBeenCalled();
  });
});

describe('a filter that makes a fact kind inapplicable', () => {
  beforeEach(() => {
    factsMock.loadIncidentFacts.mockResolvedValue([incident()]);
  });

  it('omits the presence and system-health keys rather than reporting them as zero', async () => {
    // A request filtered to one incident type has nothing to say about how many
    // days were scheduled. "0 scheduled days" is a fact about the filter.
    const report = await getOperationsAnalytics(filters({ incidentType: 'late' }), viewer, NOW);
    expect(keysOf(report.cards)).not.toContain('presence.scheduled_days');
    expect(keysOf(report.cards)).not.toContain('reliability.monitor_runs_expected');
    expect(keysOf(report.cards)).not.toContain('reliability.notifications_sent');
    expect(keysOf(report.cards)).toContain('incident.late');
  });

  it('omits them from every month of the series too, not only from the cards', async () => {
    const report = await getOperationsAnalytics(filters({ severity: 'high' }), viewer, NOW);
    for (const month of report.series) {
      expect(keysOf(month.values).filter((key) => key.startsWith('presence.'))).toEqual([]);
    }
  });

  it('keeps the incident-derived reliability keys, which the filter narrows rather than invalidates', async () => {
    const report = await getOperationsAnalytics(filters({ incidentType: 'late' }), viewer, NOW);
    expect(keysOf(report.cards)).toContain('reliability.evidence_available');
  });

  it('does not load the fact kinds it cannot use', async () => {
    await getOperationsAnalytics(filters({ incidentType: 'late' }), viewer, NOW);
    expect(presenceMock.loadPresenceFacts).not.toHaveBeenCalled();
    expect(monitorMock.loadMonitorRunFacts).not.toHaveBeenCalled();
    expect(factsMock.loadNotificationFacts).not.toHaveBeenCalled();
  });

  it('reports every key when nothing narrows the request', async () => {
    const report = await getOperationsAnalytics(filters(), viewer, NOW);
    expect(keysOf(report.cards)).toContain('presence.scheduled_days');
  });

  it('pushes a site filter into the fact query rather than only filtering in JS', async () => {
    await getOperationsAnalytics(filters({ operationalSiteId: SITE }), viewer, NOW);
    expect(factsMock.loadIncidentFacts).toHaveBeenCalledWith(
      '2026-08-01', '2026-09-01', expect.objectContaining({ operationalSiteId: SITE }),
    );
  });
});

describe('the per-request fan-out', () => {
  /** Runs a twelve-month range and reports the most months ever in flight. */
  async function peakMonthsInFlight(): Promise<number> {
    let inFlight = 0;
    let peak = 0;
    factsMock.loadIncidentFacts.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 1); });
      inFlight -= 1;
      return [];
    });
    await getOperationsAnalytics(filters({ start: '2025-09-01', end: '2026-08-31' }), viewer, NOW);
    return peak;
  }

  it('holds four months in flight at once, not the whole range', async () => {
    // The literal, not MONTH_LOAD_CONCURRENCY: comparing the measurement to the
    // constant it is meant to pin passes for any value the constant takes,
    // including twelve — which is the state this cap exists to prevent.
    const peak = await peakMonthsInFlight();
    expect(factsMock.loadIncidentFacts).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeLessThan(12);
  });

  it('keeps the exported cap and the behaviour it names in step', async () => {
    expect(MONTH_LOAD_CONCURRENCY).toBe(4);
    expect(await peakMonthsInFlight()).toBe(MONTH_LOAD_CONCURRENCY);
  });

  it('still loads every month in the range', async () => {
    await getOperationsAnalytics(filters({ start: '2026-06-01', end: '2026-08-31' }), viewer, NOW);
    expect(factsMock.loadIncidentFacts.mock.calls.map((call) => call[0]))
      .toEqual(['2026-06-01', '2026-07-01', '2026-08-01']);
  });
});
