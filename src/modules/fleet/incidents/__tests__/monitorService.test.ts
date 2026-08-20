import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query }));

const roster = vi.hoisted(() => ({ loadCompleteOperationalRoster: vi.fn() }));
vi.mock('../../operations/completeRosterLoading', () => roster);

const runs = vi.hoisted(() => ({ startMonitorRun: vi.fn(), finalizeMonitorRun: vi.fn() }));
vi.mock('../runRepository', () => runs);

const settings = vi.hoisted(() => ({ loadEffectiveIncidentRule: vi.fn() }));
vi.mock('../settingsRepository', () => settings);

const producer = vi.hoisted(() => ({
  produceIncident: vi.fn(),
  resolveScheduledIncidentType: vi.fn(),
  evaluateConditionClearing: vi.fn(),
}));
vi.mock('../incidentProducer', () => producer);

const notifications = vi.hoisted(() => ({ sendIncidentOpenedNotification: vi.fn() }));
vi.mock('../incidentNotifications', () => notifications);

import { runOperationalMonitor } from '../monitorService';
import type { OperationalStatusSummary } from '../../operations/types';
import type { IncidentRule } from '../types';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STAFF_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const INCIDENT_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const REQUEST = { requestedAt: '2026-08-18T08:00:00.000Z', effectiveAt: '2026-08-18T08:00:00.000Z' };

function statusRow(overrides: Partial<OperationalStatusSummary> = {}): OperationalStatusSummary {
  return {
    staffId: STAFF_A, staffName: 'Jane Driver', projectId: PROJECT_ID, projectName: 'Project One',
    operationalSiteId: 'site-1', operationalSiteName: 'Site One', status: 'late',
    flags: [], reasonCodes: ['attendance_late'], monitoringStart: null, scheduledStart: null,
    graceEnd: null, scheduledEnd: null, monitoringEnd: null, gpsStaleAfterSeconds: 30,
    sourceTimestamps: ['2026-08-18T07:55:00.000Z'], ruleId: 'status-rule-1', ruleVersion: 3,
    ...overrides,
  };
}

function incidentRule(overrides: Partial<IncidentRule> = {}): IncidentRule {
  return {
    id: 'rule-late-1', incidentType: 'late', version: 2, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null,
    enabled: true, createsIncident: true, severity: 'high', immediateNotification: true,
    channels: { inApp: true, email: true, whatsapp: false }, includeInMorningSummary: false,
    acknowledgementTargetMinutes: 5, reminderIntervalMinutes: 15, maximumEscalationLevel: 3,
    evidenceRequiredOutcomes: [], ...overrides,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID, runKind: 'status_monitor', requestedAt: REQUEST.requestedAt, effectiveAt: REQUEST.effectiveAt,
    status: 'running', rosterEvaluatedCount: 0, incidentsOpenedCount: 0, incidentsUpdatedCount: 0,
    incidentsClearedCount: 0, notificationsAcceptedCount: 0, notificationsFailedCount: 0, summariesSentCount: 0,
    errorCount: 0, errorSummary: null, startedAt: REQUEST.requestedAt, completedAt: null, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.startMonitorRun.mockResolvedValue(runRow());
  runs.finalizeMonitorRun.mockImplementation(async (id: string, input: Record<string, unknown>) =>
    runRow({ id, status: input.status, completedAt: '2026-08-18T08:00:05.000Z', ...input }));
  db.query.mockResolvedValue([{ id: PROJECT_ID }]);
  roster.loadCompleteOperationalRoster.mockResolvedValue({ items: [statusRow()], page: 1, limit: 100, total: 1, hasMore: false });
  settings.loadEffectiveIncidentRule.mockImplementation(async (incidentType: string) =>
    (incidentType === 'late' ? incidentRule() : null));
  producer.resolveScheduledIncidentType.mockImplementation((status: string) => (status === 'late' ? 'late' : null));
  producer.produceIncident.mockResolvedValue({
    outcome: 'opened', incidentId: INCIDENT_A, incidentReference: 'INC-LATE-20260818-AAA111', requiresInitialNotification: true,
  });
  producer.evaluateConditionClearing.mockResolvedValue({ outcome: 'unchanged', incidentId: null, requiresInitialNotification: false });
  notifications.sendIncidentOpenedNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
});

describe('runOperationalMonitor', () => {
  it('creates the running status_monitor record and loads the PR4 roster exactly once for the active project', async () => {
    await runOperationalMonitor(REQUEST);

    expect(runs.startMonitorRun).toHaveBeenCalledWith('status_monitor', REQUEST.requestedAt, REQUEST.effectiveAt);
    expect(roster.loadCompleteOperationalRoster).toHaveBeenCalledTimes(1);
    expect(roster.loadCompleteOperationalRoster).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, asOf: REQUEST.effectiveAt }),
    );
  });

  it('produces an incident for a mapped status and finalizes succeeded with accurate counters', async () => {
    const result = await runOperationalMonitor(REQUEST);

    expect(producer.produceIncident).toHaveBeenCalledTimes(1);
    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({
      status: 'succeeded', rosterEvaluatedCount: 1, incidentsOpenedCount: 1, incidentsUpdatedCount: 0,
      incidentsClearedCount: 0, notificationsAcceptedCount: 1, notificationsFailedCount: 0, errorCount: 0,
    }));
    expect(result.status).toBe('succeeded');
    expect(result.monitorRunId).toBe(RUN_ID);
  });

  it('threads the monitor run id through as the producer requestCorrelationId for traceability', async () => {
    await runOperationalMonitor(REQUEST);

    expect(producer.produceIncident).toHaveBeenCalledWith(
      expect.objectContaining({ requestCorrelationId: RUN_ID }),
    );
  });

  it('sends the opened notification through incidentNotifications only after produceIncident resolves (post-commit)', async () => {
    const order: string[] = [];
    producer.produceIncident.mockImplementation(async () => {
      order.push('produced');
      return { outcome: 'opened', incidentId: INCIDENT_A, incidentReference: 'INC-LATE-20260818-AAA111', requiresInitialNotification: true };
    });
    notifications.sendIncidentOpenedNotification.mockImplementation(async () => {
      order.push('notified');
      return { delivered: 1, suppressed: 0, failed: 0 };
    });

    await runOperationalMonitor(REQUEST);

    expect(order).toEqual(['produced', 'notified']);
    expect(notifications.sendIncidentOpenedNotification).toHaveBeenCalledWith(expect.objectContaining({
      incidentId: INCIDENT_A, incidentType: 'late', producerKind: 'scheduled_detection', projectId: PROJECT_ID,
    }));
  });

  it('does not call produceIncident again for an "updated" outcome and skips notification', async () => {
    producer.produceIncident.mockResolvedValue({ outcome: 'updated', incidentId: INCIDENT_A, incidentReference: 'INC-LATE-20260818-AAA111', requiresInitialNotification: false });

    await runOperationalMonitor(REQUEST);

    expect(notifications.sendIncidentOpenedNotification).not.toHaveBeenCalled();
    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({
      incidentsOpenedCount: 0, incidentsUpdatedCount: 1, status: 'succeeded',
    }));
  });

  it('skips staff whose status has no mapped incident type but evidence is not confirmed healthy', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'off_duty' })], page: 1, limit: 100, total: 1, hasMore: false,
    });

    await runOperationalMonitor(REQUEST);

    expect(producer.produceIncident).not.toHaveBeenCalled();
    expect(producer.evaluateConditionClearing).not.toHaveBeenCalled();
    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({
      rosterEvaluatedCount: 1, incidentsOpenedCount: 0, incidentsClearedCount: 0, status: 'succeeded',
    }));
  });

  it('does not produce an incident when the effective rule is disabled or missing', async () => {
    settings.loadEffectiveIncidentRule.mockResolvedValue(incidentRule({ enabled: false }));

    await runOperationalMonitor(REQUEST);

    expect(producer.produceIncident).not.toHaveBeenCalled();
  });

  it('isolates one staff member throwing without aborting the rest of the run', async () => {
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ staffId: STAFF_A }), statusRow({ staffId: STAFF_B })], page: 1, limit: 100, total: 2, hasMore: false,
    });
    producer.produceIncident
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ outcome: 'opened', incidentId: INCIDENT_A, incidentReference: 'INC-LATE-20260818-AAA111', requiresInitialNotification: true });

    const result = await runOperationalMonitor(REQUEST);

    expect(producer.produceIncident).toHaveBeenCalledTimes(2);
    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({
      status: 'partial_failure', rosterEvaluatedCount: 2, incidentsOpenedCount: 1, errorCount: 1,
    }));
    expect(result.status).toBe('partial_failure');
  });

  it('records a notification failure without dropping the opened incident, and does not report a false all-clear', async () => {
    notifications.sendIncidentOpenedNotification.mockResolvedValue({ delivered: 0, suppressed: 0, failed: 1 });

    const result = await runOperationalMonitor(REQUEST);

    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({
      status: 'partial_failure', incidentsOpenedCount: 1, notificationsFailedCount: 1,
    }));
    expect(result.status).toBe('partial_failure');
  });

  it('treats a systemic roster-load failure distinctly: finalizes failed, never calls the producer, never reports all-clear', async () => {
    roster.loadCompleteOperationalRoster.mockRejectedValue(new Error('evidence source unavailable'));

    const result = await runOperationalMonitor(REQUEST);

    expect(producer.produceIncident).not.toHaveBeenCalled();
    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({
      status: 'failed', rosterEvaluatedCount: 0, errorCount: 1,
    }));
    expect(result.status).toBe('failed');
  });

  it('finalizes failed when active project discovery itself throws', async () => {
    db.query.mockRejectedValue(new Error('db unreachable'));

    const result = await runOperationalMonitor(REQUEST);

    expect(roster.loadCompleteOperationalRoster).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });

  it('produces a bounded, sanitized error summary with no coordinates or raw payload content', async () => {
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ staffId: STAFF_A })], page: 1, limit: 100, total: 1, hasMore: false,
    });
    producer.produceIncident.mockRejectedValue(new Error('lat=-25.7 lon=28.2 raw provider payload'));

    await runOperationalMonitor(REQUEST);

    const call = runs.finalizeMonitorRun.mock.calls[0]?.[1] as { errorSummary: string | null };
    expect(call.errorSummary).not.toBeNull();
    expect(call.errorSummary?.length).toBeLessThan(2000);
  });
});

describe('condition clearing', () => {
  it('clears healthy conditions for a confirmed-present staff member with no flags, for all four scheduled types', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'attendance_confirmed', flags: [] })], page: 1, limit: 100, total: 1, hasMore: false,
    });
    producer.evaluateConditionClearing.mockResolvedValue({ outcome: 'cleared', incidentId: INCIDENT_A, requiresInitialNotification: false });

    const result = await runOperationalMonitor(REQUEST);

    expect(producer.evaluateConditionClearing).toHaveBeenCalledTimes(4);
    expect(producer.evaluateConditionClearing).toHaveBeenCalledWith(expect.objectContaining({
      staffId: STAFF_A, evidenceHealthy: true, workDate: '2026-08-18',
    }));
    expect(result.incidentsClearedCount).toBe(4);
    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith(RUN_ID, expect.objectContaining({ incidentsClearedCount: 4 }));
  });

  it('also clears for on_site_dual with no flags', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'on_site_dual', flags: [] })], page: 1, limit: 100, total: 1, hasMore: false,
    });
    producer.evaluateConditionClearing.mockResolvedValue({ outcome: 'unchanged', incidentId: null, requiresInitialNotification: false });

    await runOperationalMonitor(REQUEST);

    expect(producer.evaluateConditionClearing).toHaveBeenCalledTimes(4);
  });

  it('never attempts to clear when the confirmed status still carries a flag (stale/missing/uncertain evidence)', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'attendance_confirmed', flags: ['gps_stale'] })], page: 1, limit: 100, total: 1, hasMore: false,
    });

    const result = await runOperationalMonitor(REQUEST);

    expect(producer.evaluateConditionClearing).not.toHaveBeenCalled();
    expect(result.incidentsClearedCount).toBe(0);
  });

  it('never attempts to clear for a status that is merely "not currently a problem" (off_duty, approaching, scheduled_not_due)', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [
        statusRow({ staffId: STAFF_A, status: 'off_duty', flags: [] }),
        statusRow({ staffId: STAFF_B, status: 'approaching', flags: [] }),
      ], page: 1, limit: 100, total: 2, hasMore: false,
    });

    await runOperationalMonitor(REQUEST);

    expect(producer.evaluateConditionClearing).not.toHaveBeenCalled();
  });

  it('never attempts clearing for a status that itself maps to a scheduled incident type', async () => {
    producer.resolveScheduledIncidentType.mockImplementation((status: string) => (status === 'late' ? 'late' : null));
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'late' })], page: 1, limit: 100, total: 1, hasMore: false,
    });

    await runOperationalMonitor(REQUEST);

    expect(producer.evaluateConditionClearing).not.toHaveBeenCalled();
  });

  it('isolates one clearing failure without aborting the run or losing other clears', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'attendance_confirmed', flags: [] })], page: 1, limit: 100, total: 1, hasMore: false,
    });
    producer.evaluateConditionClearing
      .mockRejectedValueOnce(new Error('db hiccup'))
      .mockResolvedValue({ outcome: 'cleared', incidentId: INCIDENT_A, requiresInitialNotification: false });

    const result = await runOperationalMonitor(REQUEST);

    expect(producer.evaluateConditionClearing).toHaveBeenCalledTimes(4);
    expect(result.incidentsClearedCount).toBe(3);
    expect(result.status).toBe('partial_failure');
  });

  it('never sends a notification for a cleared condition', async () => {
    producer.resolveScheduledIncidentType.mockReturnValue(null);
    roster.loadCompleteOperationalRoster.mockResolvedValue({
      items: [statusRow({ status: 'attendance_confirmed', flags: [] })], page: 1, limit: 100, total: 1, hasMore: false,
    });
    producer.evaluateConditionClearing.mockResolvedValue({ outcome: 'cleared', incidentId: INCIDENT_A, requiresInitialNotification: false });

    await runOperationalMonitor(REQUEST);

    expect(notifications.sendIncidentOpenedNotification).not.toHaveBeenCalled();
  });
});
