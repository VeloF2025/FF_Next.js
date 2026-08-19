import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query, transaction: db.transaction }));

const runs = vi.hoisted(() => ({
  startMonitorRun: vi.fn(), finalizeMonitorRun: vi.fn(),
  findLatestMonitorRun: vi.fn(), findStaleRunningRuns: vi.fn(),
}));
vi.mock('../runRepository', () => runs);

const incidentRepo = vi.hoisted(() => ({ insertIncidentAction: vi.fn() }));
vi.mock('../incidentRepository', () => incidentRepo);

const notifications = vi.hoisted(() => ({
  sendEscalationNotification: vi.fn(),
  sendMorningSummaryNotification: vi.fn(),
  sendMonitorFailedNotification: vi.fn(),
}));
vi.mock('../incidentNotifications', () => notifications);

const recipientSvc = vi.hoisted(() => ({ resolveIncidentRecipients: vi.fn() }));
vi.mock('../recipientService', () => recipientSvc);

const settings = vi.hoisted(() => ({ loadEffectiveIncidentRule: vi.fn() }));
vi.mock('../settingsRepository', () => settings);

const monitor = vi.hoisted(() => ({ loadMonitoredRoster: vi.fn() }));
vi.mock('../monitorService', () => monitor);

const producer = vi.hoisted(() => ({ resolveScheduledIncidentType: vi.fn() }));
vi.mock('../incidentProducer', () => producer);

import { runIncidentActions } from '../actionRunner';
import type { IncidentRule } from '../types';
import type { OperationalStatusSummary } from '../../operations/types';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const SUMMARY_RUN_ID = '99999999-9999-4999-8999-999999999999';
const INCIDENT_A = '22222222-2222-4222-8222-222222222222';
const INCIDENT_B = '33333333-3333-4333-8333-333333333333';
const PROJECT = '44444444-4444-4444-8444-444444444444';
const PM = '55555555-5555-4555-8555-555555555555';

const BEFORE_0815 = { requestedAt: '2026-08-18T05:30:00.000Z', effectiveAt: '2026-08-18T05:30:00.000Z' }; // 07:30 SAST
const AFTER_0815 = { requestedAt: '2026-08-18T06:30:00.000Z', effectiveAt: '2026-08-18T06:30:00.000Z' }; // 08:30 SAST

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID, runKind: 'escalation', requestedAt: AFTER_0815.requestedAt, effectiveAt: AFTER_0815.effectiveAt,
    status: 'running', rosterEvaluatedCount: 0, incidentsOpenedCount: 0, incidentsUpdatedCount: 0,
    incidentsClearedCount: 0, notificationsAcceptedCount: 0, notificationsFailedCount: 0, summariesSentCount: 0,
    errorCount: 0, errorSummary: null, startedAt: AFTER_0815.requestedAt, completedAt: null, ...overrides,
  };
}

function dueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_A, incident_reference: 'INC-LATE-20260818-AAA111', incident_type: 'late', severity: 'high',
    project_id: PROJECT, staff_name_snapshot: 'Jane Driver', project_name_snapshot: 'Project One',
    operational_site_name_snapshot: 'Site One', escalation_level: 0,
    opened_at: '2026-08-18T06:00:00.000Z', next_escalation_at: null, source_event_id: null,
    acknowledgement_target_minutes: 15, reminder_interval_minutes: 15, maximum_escalation_level: 3,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.startMonitorRun.mockImplementation(async (kind: string) => runRow({ runKind: kind, id: kind === 'morning_summary' ? SUMMARY_RUN_ID : RUN_ID }));
  runs.finalizeMonitorRun.mockImplementation(async (id: string, input: Record<string, unknown>) => runRow({ id, ...input }));
  runs.findStaleRunningRuns.mockResolvedValue([]);
  // Kind-aware: a healthy, just-ran status monitor, and a morning summary
  // that has never run yet — every test overrides only what it needs.
  runs.findLatestMonitorRun.mockImplementation(async (kind: string) => (kind === 'status_monitor'
    ? runRow({ runKind: 'status_monitor', status: 'succeeded', startedAt: AFTER_0815.effectiveAt })
    : null));
  db.query.mockResolvedValue([]);
  db.transaction.mockImplementation(async (work: (txn: unknown) => unknown) => work({
    queryOne: vi.fn().mockResolvedValue({ lifecycle_status: 'open', escalation_level: 0 }),
    query: vi.fn().mockResolvedValue([]),
  }));
  incidentRepo.insertIncidentAction.mockResolvedValue({ id: 'action-1' });
  notifications.sendEscalationNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
  notifications.sendMorningSummaryNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
  notifications.sendMonitorFailedNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
  recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [PM], failed: false });
  settings.loadEffectiveIncidentRule.mockResolvedValue(null);
  monitor.loadMonitoredRoster.mockResolvedValue([]);
  producer.resolveScheduledIncidentType.mockReturnValue(null);
});

describe('escalation phase', () => {
  it('escalates only due open incidents past their acknowledgement target', async () => {
    db.query.mockResolvedValueOnce([dueRow()]);

    const result = await runIncidentActions(AFTER_0815);

    expect(result.escalatedCount).toBe(1);
    expect(notifications.sendEscalationNotification).toHaveBeenCalledWith(expect.objectContaining({
      incidentId: INCIDENT_A, escalationLevel: 1, producerKind: 'scheduled_detection',
    }));
  });

  it('derives producerKind "source_event" from a non-null source_event_id', async () => {
    db.query.mockResolvedValueOnce([dueRow({ source_event_id: 'evt-123' })]);

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendEscalationNotification).toHaveBeenCalledWith(expect.objectContaining({
      producerKind: 'source_event',
    }));
  });

  it('atomically increments the escalation level and appends one escalated action', async () => {
    db.query.mockResolvedValueOnce([dueRow({ escalation_level: 1, next_escalation_at: '2026-08-18T06:15:00.000Z' })]);
    const txnQuery = vi.fn().mockResolvedValue([]);
    db.transaction.mockImplementation(async (work: (txn: unknown) => unknown) => work({
      queryOne: vi.fn().mockResolvedValue({ lifecycle_status: 'open', escalation_level: 1 }),
      query: txnQuery,
    }));

    await runIncidentActions(AFTER_0815);

    expect(incidentRepo.insertIncidentAction).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'escalated', beforeEscalationLevel: 1, afterEscalationLevel: 2, isSystemActor: true }),
      expect.anything(),
    );
    const updateCall = txnQuery.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE fleet_operational_incidents'));
    expect(updateCall?.[1]).toContain(2);
  });

  it('respects a configured 5-minute acknowledgement target', async () => {
    db.query.mockResolvedValueOnce([dueRow({ acknowledgement_target_minutes: 5, opened_at: '2026-08-18T06:20:00.000Z' })]);

    const result = await runIncidentActions(AFTER_0815); // effective 06:30 = 10 min after opened_at

    expect(result.escalatedCount).toBe(1);
  });

  it('respects a configured 30-minute acknowledgement target by not escalating early', async () => {
    // The candidate query itself encodes the "past target" condition — a fixture
    // whose target has not elapsed simply never appears in query results.
    db.query.mockResolvedValueOnce([]);

    const result = await runIncidentActions(AFTER_0815);

    expect(result.escalatedCount).toBe(0);
    expect(notifications.sendEscalationNotification).not.toHaveBeenCalled();
  });

  it('schedules the next reminder using the configured reminder interval', async () => {
    db.query.mockResolvedValueOnce([dueRow()]);
    const txnQuery = vi.fn().mockResolvedValue([]);
    db.transaction.mockImplementation(async (work: (txn: unknown) => unknown) => work({
      queryOne: vi.fn().mockResolvedValue({ lifecycle_status: 'open', escalation_level: 0 }),
      query: txnQuery,
    }));

    await runIncidentActions(AFTER_0815);

    const updateCall = txnQuery.mock.calls.find(([sql]: [string]) => sql.includes('UPDATE fleet_operational_incidents'));
    // opened at 06:00, effective 06:30, reminder interval 15 -> next escalation should be 06:45
    expect(updateCall?.[1]).toContain('2026-08-18T06:45:00.000Z');
  });

  it('stops at the maximum escalation level and does not query candidates past it (query itself filters)', async () => {
    db.query.mockResolvedValueOnce([]); // a fixture at max level would never be returned by the due-candidates query

    const result = await runIncidentActions(AFTER_0815);

    expect(result.escalatedCount).toBe(0);
  });

  it('locking finds the incident already acknowledged and skips escalating it (acknowledgement stops reminders)', async () => {
    db.query.mockResolvedValueOnce([dueRow()]);
    db.transaction.mockImplementation(async (work: (txn: unknown) => unknown) => work({
      queryOne: vi.fn().mockResolvedValue({ lifecycle_status: 'acknowledged', escalation_level: 0 }),
      query: vi.fn().mockResolvedValue([]),
    }));

    const result = await runIncidentActions(AFTER_0815);

    expect(result.escalatedCount).toBe(0);
    expect(notifications.sendEscalationNotification).not.toHaveBeenCalled();
  });

  it('isolates one incident throwing during escalation without aborting the others', async () => {
    db.query.mockResolvedValueOnce([dueRow({ id: INCIDENT_A }), dueRow({ id: INCIDENT_B })]);
    let call = 0;
    db.transaction.mockImplementation(async (work: (txn: unknown) => unknown) => {
      call += 1;
      if (call === 1) throw new Error('db hiccup');
      return work({ queryOne: vi.fn().mockResolvedValue({ lifecycle_status: 'open', escalation_level: 0 }), query: vi.fn().mockResolvedValue([]) });
    });

    const result = await runIncidentActions(AFTER_0815);

    expect(result.escalatedCount).toBe(1);
    expect(result.status).toBe('partial_failure');
  });

  it('resolves the incident current recipients fresh for each escalation notification', async () => {
    db.query.mockResolvedValueOnce([dueRow()]);

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendEscalationNotification).toHaveBeenCalledWith(expect.objectContaining({ projectId: PROJECT }));
  });

  it('records a notification failure without losing the escalation', async () => {
    db.query.mockResolvedValueOnce([dueRow()]);
    notifications.sendEscalationNotification.mockResolvedValue({ delivered: 0, suppressed: 0, failed: 1 });

    const result = await runIncidentActions(AFTER_0815);

    expect(result.escalatedCount).toBe(1);
    expect(result.status).toBe('partial_failure');
  });
});

describe('morning summary phase', () => {
  function staffItem(overrides: Partial<OperationalStatusSummary> = {}): OperationalStatusSummary {
    return {
      staffId: 'staff-1', staffName: 'Jane Driver', projectId: PROJECT, projectName: 'Project One',
      operationalSiteId: 'site-1', operationalSiteName: 'Site One', status: 'unassigned',
      flags: [], reasonCodes: [], monitoringStart: null, scheduledStart: null, graceEnd: null,
      scheduledEnd: null, monitoringEnd: null, gpsStaleAfterSeconds: null, sourceTimestamps: [],
      ruleId: 'status-rule-1', ruleVersion: 1, ...overrides,
    };
  }
  const unassignedRule: IncidentRule = {
    id: 'rule-unassigned', incidentType: 'unassigned', version: 1, effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null, enabled: true, createsIncident: false, severity: 'normal', immediateNotification: false,
    channels: { inApp: true, email: true, whatsapp: false }, includeInMorningSummary: true,
    acknowledgementTargetMinutes: 30, reminderIntervalMinutes: 15, maximumEscalationLevel: 0, evidenceRequiredOutcomes: [],
  };

  it('skips the summary phase entirely before 08:15 SAST', async () => {
    await runIncidentActions(BEFORE_0815);

    expect(runs.startMonitorRun).not.toHaveBeenCalledWith('morning_summary', expect.anything(), expect.anything());
    expect(notifications.sendMorningSummaryNotification).not.toHaveBeenCalled();
  });

  it('sends exactly one summary per recipient/project/work-date at or after 08:15', async () => {
    monitor.loadMonitoredRoster.mockResolvedValue([staffItem()]);
    settings.loadEffectiveIncidentRule.mockImplementation(async (type: string) => (type === 'unassigned' ? unassignedRule : null));

    const result = await runIncidentActions(AFTER_0815);

    expect(notifications.sendMorningSummaryNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendMorningSummaryNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipientUserId: PM, projectId: PROJECT,
    }));
    expect(result.summariesSentCount).toBe(1);
  });

  it('does not re-send the summary later the same work date', async () => {
    runs.findLatestMonitorRun.mockImplementation(async (kind: string) => (kind === 'morning_summary'
      ? runRow({ runKind: 'morning_summary', status: 'succeeded', effectiveAt: AFTER_0815.effectiveAt })
      : runRow({ runKind: 'status_monitor', status: 'succeeded', startedAt: AFTER_0815.effectiveAt })));

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendMorningSummaryNotification).not.toHaveBeenCalled();
    expect(monitor.loadMonitoredRoster).not.toHaveBeenCalled();
  });

  it('retries the summary after a run that failed earlier the same work date', async () => {
    // A `failed` run sent nothing. Treating it as "already sent" cost every project
    // manager that day's summary, and no health check covers `morning_summary`.
    runs.findLatestMonitorRun.mockImplementation(async (kind: string) => (kind === 'morning_summary'
      ? runRow({ runKind: 'morning_summary', status: 'failed', effectiveAt: AFTER_0815.effectiveAt })
      : runRow({ runKind: 'status_monitor', status: 'succeeded', startedAt: AFTER_0815.effectiveAt })));
    monitor.loadMonitoredRoster.mockResolvedValue([staffItem()]);
    settings.loadEffectiveIncidentRule.mockImplementation(async (type: string) => (type === 'unassigned' ? unassignedRule : null));

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendMorningSummaryNotification).toHaveBeenCalledTimes(1);
  });

  it('still treats a crashed `running` run as retryable, not as already sent', async () => {
    // The cron's advisory lock already excludes a concurrent second invocation, so a
    // `running` row for today can only be a run that died before finalizing.
    runs.findLatestMonitorRun.mockImplementation(async (kind: string) => (kind === 'morning_summary'
      ? runRow({ runKind: 'morning_summary', status: 'running', effectiveAt: AFTER_0815.effectiveAt })
      : runRow({ runKind: 'status_monitor', status: 'succeeded', startedAt: AFTER_0815.effectiveAt })));
    monitor.loadMonitoredRoster.mockResolvedValue([staffItem()]);
    settings.loadEffectiveIncidentRule.mockImplementation(async (type: string) => (type === 'unassigned' ? unassignedRule : null));

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendMorningSummaryNotification).toHaveBeenCalledTimes(1);
  });

  it('one project failing does not cost the remaining projects their summary', async () => {
    const OTHER_PROJECT = '55555555-5555-4555-8555-555555555555';
    monitor.loadMonitoredRoster.mockResolvedValue([
      staffItem(),
      staffItem({ staffId: 'staff-2', projectId: OTHER_PROJECT, projectName: 'Project Two' }),
    ]);
    settings.loadEffectiveIncidentRule.mockImplementation(async (type: string) => (type === 'unassigned' ? unassignedRule : null));
    // The first bucket's recipient lookup throws rather than returning `failed` — a
    // transient DB error. It must not abort the buckets that follow.
    recipientSvc.resolveIncidentRecipients.mockImplementation(async (projectId: string | null) => {
      if (projectId === PROJECT) throw new Error('connection terminated');
      return { userIds: [PM], failed: false };
    });

    const result = await runIncidentActions(AFTER_0815);

    expect(notifications.sendMorningSummaryNotification).toHaveBeenCalledTimes(1);
    expect(notifications.sendMorningSummaryNotification).toHaveBeenCalledWith(expect.objectContaining({
      projectId: OTHER_PROJECT,
    }));
    expect(result.summariesSentCount).toBe(1);
  });

  it('produces no incidents for summary-only conditions', async () => {
    monitor.loadMonitoredRoster.mockResolvedValue([staffItem()]);
    settings.loadEffectiveIncidentRule.mockImplementation(async (type: string) => (type === 'unassigned' ? unassignedRule : null));

    await runIncidentActions(AFTER_0815);

    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('contains no coordinates in the summary payload', async () => {
    monitor.loadMonitoredRoster.mockResolvedValue([staffItem()]);
    settings.loadEffectiveIncidentRule.mockImplementation(async (type: string) => (type === 'unassigned' ? unassignedRule : null));

    await runIncidentActions(AFTER_0815);

    const call = notifications.sendMorningSummaryNotification.mock.calls[0]?.[0];
    expect(JSON.stringify(call)).not.toMatch(/latitude|longitude/i);
  });
});

describe('status-monitor health check', () => {
  it('converts a stale running status-monitor run to failed and sends a critical health notification', async () => {
    runs.findStaleRunningRuns.mockResolvedValue([runRow({ id: 'stale-run-1', runKind: 'status_monitor', status: 'running' })]);

    await runIncidentActions(AFTER_0815);

    expect(runs.finalizeMonitorRun).toHaveBeenCalledWith('stale-run-1', expect.objectContaining({ status: 'failed' }));
    expect(notifications.sendMonitorFailedNotification).toHaveBeenCalledWith(expect.objectContaining({ runId: 'stale-run-1', runKind: 'status_monitor' }));
  });

  it('detects a missing status-monitor run (none started recently) and alerts', async () => {
    runs.findLatestMonitorRun.mockResolvedValue(null);

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendMonitorFailedNotification).toHaveBeenCalledWith(expect.objectContaining({ runKind: 'status_monitor' }));
  });

  it('does not alert when the status monitor has run recently and healthily', async () => {
    runs.findLatestMonitorRun.mockResolvedValue(runRow({ runKind: 'status_monitor', status: 'succeeded', startedAt: AFTER_0815.effectiveAt }));

    await runIncidentActions(AFTER_0815);

    expect(notifications.sendMonitorFailedNotification).not.toHaveBeenCalled();
  });

  it('is idempotent across repeat checks for the same missing condition on the same work date', async () => {
    runs.findLatestMonitorRun.mockImplementation(async (kind: string) => (kind === 'status_monitor' ? null : runRow({ status: 'succeeded' })));

    await runIncidentActions(AFTER_0815);
    const firstCallKey = notifications.sendMonitorFailedNotification.mock.calls[0]?.[0]?.runId;

    notifications.sendMonitorFailedNotification.mockClear();
    await runIncidentActions(AFTER_0815);
    const secondCallKey = notifications.sendMonitorFailedNotification.mock.calls[0]?.[0]?.runId;

    expect(firstCallKey).toBe(secondCallKey);
  });
});
