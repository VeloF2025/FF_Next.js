import { beforeEach, describe, expect, it, vi } from 'vitest';

const bus = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationBus', () => bus);

const authority = vi.hoisted(() => ({ resolveHoldAuthorityRecipients: vi.fn() }));
vi.mock('../holdAuthority', () => authority);

const holdRepo = vi.hoisted(() => ({ listHoldsDueForReview: vi.fn() }));
vi.mock('../holdRepository', () => holdRepo);

const health = vi.hoisted(() => ({
  getLatestAggregationRun: vi.fn(), getLatestRetentionRun: vi.fn(),
  countRepeatedFailedRetentionItems: vi.fn(), countAgedNonTerminalIncidents: vi.fn(),
}));
vi.mock('../retentionHealthRepository', () => health);

const settings = vi.hoisted(() => ({ getEffectiveAnalyticsRetentionSettings: vi.fn() }));
vi.mock('../../analytics/settingsRepository', () => settings);

import { notifyRetentionHealth } from '../retentionNotifications';

const ADMIN = '66666666-6666-4666-8666-666666666666';
const OWNER = '44444444-4444-4444-8444-444444444444';
const NOW = '2026-08-21T09:00:00.000Z';

const policy = {
  version: 1, effectiveFrom: '2026-08-01T00:00:00.000Z', retentionMonths: 12, anonymityMinContributors: 5,
  recalculationWindowMonths: 3, retentionBatchSize: 100, maximumHoldReviewDays: 90,
  holdReviewReminderLeadDays: 14, aggregationRunHourSast: 1, aggregationRunMinuteSast: 0,
  retentionRunHourSast: 3, retentionRunMinuteSast: 30, aggregateFreshnessWarningHours: 36,
  retentionFreshnessWarningHours: 48, permittedHoldCategories: ['legal'], metricVersion: 1,
  liveRetentionEnabled: false,
};

const approachingHold = {
  holdId: 'hold-1', incidentId: 'incident-1', incidentReference: 'INC-LATE-0001', projectId: 'project-1',
  category: 'legal' as const, ownerUserId: OWNER, nextReviewAt: '2026-08-30T00:00:00.000Z', overdue: false,
};
const overdueHold = { ...approachingHold, holdId: 'hold-2', incidentId: 'incident-2', incidentReference: 'INC-LATE-0002', nextReviewAt: '2026-08-19T00:00:00.000Z', overdue: true };

function happyPath(): void {
  settings.getEffectiveAnalyticsRetentionSettings.mockResolvedValue(policy);
  authority.resolveHoldAuthorityRecipients.mockResolvedValue([ADMIN]);
  holdRepo.listHoldsDueForReview.mockResolvedValue([]);
  health.getLatestAggregationRun.mockResolvedValue({ status: 'succeeded', startedAt: '2026-08-21T01:00:00.000Z', finishedAt: '2026-08-21T01:05:00.000Z' });
  health.getLatestRetentionRun.mockResolvedValue({ status: 'succeeded', dryRun: true, startedAt: '2026-08-21T03:30:00.000Z', finishedAt: '2026-08-21T03:35:00.000Z' });
  health.countRepeatedFailedRetentionItems.mockResolvedValue(0);
  health.countAgedNonTerminalIncidents.mockResolvedValue(0);
  bus.notify.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  happyPath();
});

describe('hold review reminders', () => {
  it('sends nothing when everything is healthy and no review is due', async () => {
    const result = await notifyRetentionHealth({ at: NOW });
    expect(bus.notify).not.toHaveBeenCalled();
    expect(result.notificationsSent).toBe(0);
  });

  it('reminds about an approaching review using the configured lead time', async () => {
    holdRepo.listHoldsDueForReview.mockResolvedValue([approachingHold]);
    await notifyRetentionHealth({ at: NOW });
    expect(holdRepo.listHoldsDueForReview).toHaveBeenCalledWith({ asOf: NOW, leadDays: 14 });
    const payload = bus.notify.mock.calls[0]![0];
    expect(payload).toMatchObject({ event_type: 'fleet.retention_hold_review_due', recipient_user_ids: [ADMIN] });
    expect(payload.action_url).toBe('/fleet/incidents?incidentId=incident-1');
  });

  it('distinguishes an overdue review from an approaching one', async () => {
    holdRepo.listHoldsDueForReview.mockResolvedValue([overdueHold]);
    await notifyRetentionHealth({ at: NOW });
    expect(String(bus.notify.mock.calls[0]![0].title)).toMatch(/overdue/i);
  });

  // A missed review alerts. It never auto-releases and never deletes.
  it('never releases or deletes on an overdue review', async () => {
    holdRepo.listHoldsDueForReview.mockResolvedValue([overdueHold]);
    const result = await notifyRetentionHealth({ at: NOW });
    expect(result.holdsReleased).toBeUndefined();
    expect(bus.notify).toHaveBeenCalledTimes(1);
  });

  it('keys idempotency per hold, per review date and per condition', async () => {
    holdRepo.listHoldsDueForReview.mockResolvedValue([approachingHold, overdueHold]);
    await notifyRetentionHealth({ at: NOW });
    const keys = bus.notify.mock.calls.map(([payload]) => payload.idempotency_key);
    expect(keys).toEqual([
      'fleet-retention-hold-review:hold-1:2026-08-30:approaching',
      'fleet-retention-hold-review:hold-2:2026-08-19:overdue',
    ]);
  });

  // The notification carries a reference, a category, a date and a scoped
  // link. It never carries the driver's name or the reason prose — a bell
  // notification is seen by more eyes than the incident is.
  it('carries no staff identity or hold prose', async () => {
    holdRepo.listHoldsDueForReview.mockResolvedValue([approachingHold]);
    await notifyRetentionHealth({ at: NOW });
    const payload = bus.notify.mock.calls[0]![0];
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('INC-LATE-0001');
    expect(serialized).not.toMatch(/staffName|driver|reason|explanation/i);
  });

  it('addresses the hold owner only when they still carry hold authority', async () => {
    authority.resolveHoldAuthorityRecipients.mockResolvedValue([ADMIN, OWNER]);
    holdRepo.listHoldsDueForReview.mockResolvedValue([approachingHold]);
    await notifyRetentionHealth({ at: NOW });
    expect(bus.notify.mock.calls[0]![0].recipient_user_ids).toEqual([ADMIN, OWNER]);
  });

  // A project manager sees the hold badge on their own incident. Paging them
  // about a retention decision they cannot act on is exactly what the
  // permission split exists to prevent.
  it('sends nothing at all when no authorised recipient exists', async () => {
    authority.resolveHoldAuthorityRecipients.mockResolvedValue([]);
    holdRepo.listHoldsDueForReview.mockResolvedValue([approachingHold, overdueHold]);
    const result = await notifyRetentionHealth({ at: NOW });
    expect(bus.notify).not.toHaveBeenCalled();
    expect(result.recipientsMissing).toBe(true);
  });

  it('isolates a delivery failure so later conditions still notify', async () => {
    holdRepo.listHoldsDueForReview.mockResolvedValue([approachingHold, overdueHold]);
    bus.notify.mockRejectedValueOnce(new Error('bus down'));
    const result = await notifyRetentionHealth({ at: NOW });
    expect(bus.notify).toHaveBeenCalledTimes(2);
    expect(result.notificationsFailed).toBe(1);
    expect(result.notificationsSent).toBe(1);
  });
});

describe('automation health', () => {
  it('alerts when the last aggregation run failed', async () => {
    health.getLatestAggregationRun.mockResolvedValue({ status: 'failed', startedAt: '2026-08-21T01:00:00.000Z', finishedAt: '2026-08-21T01:01:00.000Z' });
    await notifyRetentionHealth({ at: NOW });
    expect(bus.notify.mock.calls[0]![0].event_type).toBe('fleet.operational_aggregation_failed');
  });

  it('alerts when aggregation is stale past the configured freshness window', async () => {
    health.getLatestAggregationRun.mockResolvedValue({ status: 'succeeded', startedAt: '2026-08-19T01:00:00.000Z', finishedAt: '2026-08-19T01:05:00.000Z' });
    await notifyRetentionHealth({ at: NOW });
    expect(bus.notify.mock.calls[0]![0].event_type).toBe('fleet.operational_aggregation_failed');
  });

  it('alerts when aggregation has never run at all', async () => {
    health.getLatestAggregationRun.mockResolvedValue(null);
    await notifyRetentionHealth({ at: NOW });
    expect(bus.notify.mock.calls[0]![0].event_type).toBe('fleet.operational_aggregation_failed');
  });

  it('does not alert while aggregation is inside the freshness window', async () => {
    health.getLatestAggregationRun.mockResolvedValue({ status: 'succeeded', startedAt: '2026-08-20T01:00:00.000Z', finishedAt: '2026-08-20T01:05:00.000Z' });
    await notifyRetentionHealth({ at: NOW });
    expect(bus.notify).not.toHaveBeenCalled();
  });

  it('alerts on repeatedly failing purge items even when the run reported success', async () => {
    health.countRepeatedFailedRetentionItems.mockResolvedValue(3);
    await notifyRetentionHealth({ at: NOW });
    const payload = bus.notify.mock.calls[0]![0];
    expect(payload.event_type).toBe('fleet.operational_retention_failed');
    expect(payload.metadata).toMatchObject({ repeatedFailures: 3 });
  });

  it('reports aged non-terminal incidents as a count only', async () => {
    health.countAgedNonTerminalIncidents.mockResolvedValue(7);
    await notifyRetentionHealth({ at: NOW });
    const payload = bus.notify.mock.calls[0]![0];
    expect(payload.event_type).toBe('fleet.operational_retention_failed');
    expect(payload.metadata).toMatchObject({ agedNonTerminal: 7 });
    expect(JSON.stringify(payload)).not.toMatch(/incidentId|staff/i);
  });

  it('keys automation alerts per condition and per calendar day', async () => {
    health.getLatestAggregationRun.mockResolvedValue(null);
    health.getLatestRetentionRun.mockResolvedValue(null);
    await notifyRetentionHealth({ at: NOW });
    expect(bus.notify.mock.calls.map(([payload]) => payload.idempotency_key)).toEqual([
      'fleet-operational-aggregation-health:2026-08-21',
      'fleet-operational-retention-health:2026-08-21',
    ]);
  });
});
