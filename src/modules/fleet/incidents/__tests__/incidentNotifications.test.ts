import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const bus = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationBus', () => bus);

const wa = vi.hoisted(() => ({ deliverWhatsApp: vi.fn() }));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => wa);

const idem = vi.hoisted(() => ({ claimNotification: vi.fn(), releaseNotificationClaim: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationIdempotency', () => idem);

const recipients = vi.hoisted(() => ({ resolveIncidentRecipients: vi.fn() }));
vi.mock('../recipientService', () => recipients);

import {
  buildIncidentEscalatedIdempotencyKey,
  buildIncidentOpenedIdempotencyKey,
  buildIncidentResolvedIdempotencyKey,
  buildMonitorFailedIdempotencyKey,
  buildMorningSummaryIdempotencyKey,
  sendEscalationNotification,
  sendIncidentOpenedNotification,
  sendMonitorFailedNotification,
  sendMorningSummaryNotification,
  sendResolutionNotification,
} from '../incidentNotifications';
import type { IncidentRule } from '../types';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const PM = '33333333-3333-4333-8333-333333333333';
const OVERSIGHT = '44444444-4444-4444-8444-444444444444';

function rule(overrides: Partial<IncidentRule> = {}): IncidentRule {
  return {
    id: 'rule-1', incidentType: 'late', version: 1, effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null,
    enabled: true, createsIncident: true, severity: 'high', immediateNotification: true,
    channels: { inApp: true, email: true, whatsapp: false }, includeInMorningSummary: false,
    acknowledgementTargetMinutes: 15, reminderIntervalMinutes: 15, maximumEscalationLevel: 3,
    evidenceRequiredOutcomes: [], ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recipients.resolveIncidentRecipients.mockResolvedValue({ userIds: [PM, OVERSIGHT], failed: false });
  bus.notify.mockResolvedValue({ delivered: 2, suppressed: 0, failed: 0 });
  wa.deliverWhatsApp.mockResolvedValue(undefined);
  idem.claimNotification.mockResolvedValue(true);
  idem.releaseNotificationClaim.mockResolvedValue(undefined);
});

describe('idempotency keys', () => {
  it('match the approved design exactly', () => {
    expect(buildIncidentOpenedIdempotencyKey(INCIDENT)).toBe(`fleet-incident-opened:${INCIDENT}`);
    expect(buildIncidentEscalatedIdempotencyKey(INCIDENT, 2)).toBe(`fleet-incident-escalated:${INCIDENT}:2`);
    expect(buildIncidentResolvedIdempotencyKey(INCIDENT, 'valid_reason')).toBe(`fleet-incident-resolved:${INCIDENT}:valid_reason`);
    expect(buildMorningSummaryIdempotencyKey(PM, PROJECT, '2026-08-18')).toBe(`fleet-morning-summary:${PM}:${PROJECT}:2026-08-18`);
    expect(buildMorningSummaryIdempotencyKey(PM, null, '2026-08-18')).toBe(`fleet-morning-summary:${PM}:unassigned:2026-08-18`);
  });
});

describe('sendIncidentOpenedNotification', () => {
  const baseInput = {
    incidentId: INCIDENT, incidentReference: 'INC-LATE-20260818-ABC123', incidentType: 'late' as const,
    severity: 'high' as const, producerKind: 'scheduled_detection' as const, rule: rule(),
    projectId: PROJECT, staffName: 'Jane Driver', projectName: 'Project One', operationalSiteName: 'Site One',
    detectedAt: '2026-08-18T08:00:00.000Z', reasonCodes: ['attendance_late'],
  };

  it('resolves recipients and sends with the opened idempotency key', async () => {
    await sendIncidentOpenedNotification(baseInput);

    expect(recipients.resolveIncidentRecipients).toHaveBeenCalledWith(PROJECT);
    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'fleet.operational_incident_opened',
      recipient_user_ids: [PM, OVERSIGHT],
      idempotency_key: `fleet-incident-opened:${INCIDENT}`,
      source_id: INCIDENT,
    }));
  });

  it('omits coordinates, raw GPS data, and disciplinary language from the payload', async () => {
    await sendIncidentOpenedNotification(baseInput);

    const payload = bus.notify.mock.calls[0]?.[0];
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toMatch(/latitude|longitude|"lat"|"lng"|gps_stale_after_seconds/);
    expect(serialized).not.toMatch(/fraud|discipline|disciplinary|terminate|dismissal warning/);
  });

  it('records a failure and never calls notify() when recipients cannot be resolved', async () => {
    recipients.resolveIncidentRecipients.mockResolvedValue({ userIds: [], failed: true });

    const result = await sendIncidentOpenedNotification(baseInput);

    expect(bus.notify).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: 0, suppressed: 0, failed: 1 });
  });

  it('sends WhatsApp directly to every recipient for a critical source-event incident, in addition to notify()', async () => {
    await sendIncidentOpenedNotification({
      ...baseInput, producerKind: 'source_event', severity: 'critical',
      incidentType: 'accident_sos', rule: rule({ incidentType: 'accident_sos', severity: 'critical', channels: { inApp: true, email: true, whatsapp: true } }),
    });

    expect(wa.deliverWhatsApp).toHaveBeenCalledTimes(2);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(PM, expect.anything(), null);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(OVERSIGHT, expect.anything(), null);
  });

  it('claims each recipient under a whatsapp-suffixed event before sending', async () => {
    // notify() has already claimed (user, event_type, key) for the in-app/email fan-out, so
    // the WhatsApp leg must claim a distinct namespace or it would suppress itself entirely.
    await sendIncidentOpenedNotification({
      ...baseInput, producerKind: 'source_event', severity: 'critical', incidentType: 'accident_sos',
      rule: rule({ incidentType: 'accident_sos', severity: 'critical' }),
    });

    const key = buildIncidentOpenedIdempotencyKey(baseInput.incidentId);
    expect(idem.claimNotification).toHaveBeenCalledWith(PM, 'fleet.operational_incident_opened:whatsapp', key);
    expect(idem.claimNotification).toHaveBeenCalledWith(OVERSIGHT, 'fleet.operational_incident_opened:whatsapp', key);
  });

  it('does not re-send mandatory WhatsApp to a recipient whose claim is already held', async () => {
    idem.claimNotification.mockImplementation(async (userId: string) => userId !== PM);

    await sendIncidentOpenedNotification({
      ...baseInput, producerKind: 'source_event', severity: 'critical', incidentType: 'accident_sos',
      rule: rule({ incidentType: 'accident_sos', severity: 'critical' }),
    });

    expect(wa.deliverWhatsApp).toHaveBeenCalledTimes(1);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(OVERSIGHT, expect.anything(), null);
  });

  it('releases the claim when a mandatory WhatsApp send fails so a retry can reach them', async () => {
    // A transient bridge outage must not permanently silence the one channel a critical
    // incident is guaranteed to reach.
    wa.deliverWhatsApp.mockRejectedValueOnce(new Error('WA bridge down'));

    await sendIncidentOpenedNotification({
      ...baseInput, producerKind: 'source_event', severity: 'critical', incidentType: 'accident_sos',
      rule: rule({ incidentType: 'accident_sos', severity: 'critical' }),
    });

    expect(idem.releaseNotificationClaim).toHaveBeenCalledWith(
      PM, 'fleet.operational_incident_opened:whatsapp', buildIncidentOpenedIdempotencyKey(baseInput.incidentId));
  });
  it('never sends mandatory WhatsApp for a routine scheduled incident, even if critical', async () => {
    await sendIncidentOpenedNotification({
      ...baseInput, severity: 'critical', producerKind: 'scheduled_detection',
      rule: rule({ severity: 'critical' }),
    });

    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('never sends mandatory WhatsApp for a non-critical source event', async () => {
    await sendIncidentOpenedNotification({
      ...baseInput, severity: 'high', producerKind: 'source_event', incidentType: 'severe_driving',
      rule: rule({ incidentType: 'severe_driving', severity: 'high' }),
    });

    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('counts a mandatory WhatsApp delivery failure without throwing', async () => {
    wa.deliverWhatsApp.mockRejectedValueOnce(new Error('WA bridge down'));

    const result = await sendIncidentOpenedNotification({
      ...baseInput, producerKind: 'source_event', severity: 'critical', incidentType: 'accident_sos',
      rule: rule({ incidentType: 'accident_sos', severity: 'critical' }),
    });

    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});

describe('sendEscalationNotification', () => {
  const input = {
    incidentId: INCIDENT, incidentReference: 'INC-LATE-20260818-ABC123', incidentType: 'late' as const,
    severity: 'high' as const, producerKind: 'scheduled_detection' as const,
    projectId: PROJECT, staffName: 'Jane Driver', projectName: 'Project One',
    operationalSiteName: 'Site One', escalationLevel: 2,
  };

  it('uses the incident id + escalation level idempotency key', async () => {
    await sendEscalationNotification(input);

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'fleet.operational_incident_escalated',
      idempotency_key: `fleet-incident-escalated:${INCIDENT}:2`,
    }));
  });

  it('resolves current recipients fresh rather than reusing a snapshot', async () => {
    await sendEscalationNotification(input);
    expect(recipients.resolveIncidentRecipients).toHaveBeenCalledWith(PROJECT);
  });

  it('records a failure when no recipient can be resolved', async () => {
    recipients.resolveIncidentRecipients.mockResolvedValue({ userIds: [], failed: true });

    const result = await sendEscalationNotification(input);

    expect(bus.notify).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  // Locked product decision: routine/high/scheduled incidents must never gain
  // mandatory WhatsApp just because they escalated.
  it('never sends mandatory WhatsApp for a routine scheduled escalation, even at a late escalation level', async () => {
    await sendEscalationNotification({ ...input, severity: 'high', producerKind: 'scheduled_detection', escalationLevel: 3 });

    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('never sends mandatory WhatsApp for a critical scheduled-detection escalation (producerKind gates it too)', async () => {
    await sendEscalationNotification({ ...input, severity: 'critical', producerKind: 'scheduled_detection' });

    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('sends mandatory WhatsApp directly to every recipient for a critical source-event escalation, in addition to notify()', async () => {
    await sendEscalationNotification({ ...input, severity: 'critical', producerKind: 'source_event', incidentType: 'accident_sos' });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'fleet.operational_incident_escalated' }));
    expect(wa.deliverWhatsApp).toHaveBeenCalledTimes(2);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(PM, expect.anything(), null);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(OVERSIGHT, expect.anything(), null);
  });

  it('counts a mandatory WhatsApp delivery failure on escalation without throwing', async () => {
    wa.deliverWhatsApp.mockRejectedValueOnce(new Error('WA bridge down'));

    const result = await sendEscalationNotification({ ...input, severity: 'critical', producerKind: 'source_event', incidentType: 'accident_sos' });

    expect(result.failed).toBeGreaterThanOrEqual(1);
  });
});

describe('sendResolutionNotification', () => {
  const input = {
    incidentId: INCIDENT, incidentReference: 'INC-LATE-20260818-ABC123', incidentType: 'late' as const,
    severity: 'high' as const, projectId: PROJECT, staffName: 'Jane Driver',
    lifecycleStatus: 'resolved' as const, outcome: 'valid_reason' as const, resolutionNote: 'Traffic delay confirmed with client sign-in',
  };

  it('uses the incident id + terminal outcome idempotency key', async () => {
    await sendResolutionNotification(input);

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'fleet.operational_incident_resolved',
      idempotency_key: `fleet-incident-resolved:${INCIDENT}:valid_reason`,
    }));
  });

  it('is informational and includes the outcome/note summary', async () => {
    await sendResolutionNotification(input);

    const payload = bus.notify.mock.calls[0]?.[0];
    expect(String(payload.body)).toContain('Traffic delay confirmed');
  });
});

describe('sendMorningSummaryNotification', () => {
  const input = {
    recipientUserId: PM, projectId: PROJECT, projectName: 'Project One', workDate: '2026-08-18',
    items: [{ incidentType: 'unassigned' as const, count: 3 }, { incidentType: 'evidence_gap' as const, count: 1 }],
  };

  it('uses the recipient/project/work-date idempotency key exactly', async () => {
    await sendMorningSummaryNotification(input);

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'fleet.operational_morning_summary',
      idempotency_key: `fleet-morning-summary:${PM}:${PROJECT}:2026-08-18`,
      recipient_user_ids: [PM],
    }));
  });

  it('uses "unassigned" for a projectless summary group', async () => {
    await sendMorningSummaryNotification({ ...input, projectId: null, projectName: null });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      idempotency_key: `fleet-morning-summary:${PM}:unassigned:2026-08-18`,
    }));
  });

  it('contains no coordinates', async () => {
    await sendMorningSummaryNotification(input);

    const serialized = JSON.stringify(bus.notify.mock.calls[0]?.[0]).toLowerCase();
    expect(serialized).not.toMatch(/latitude|longitude/);
  });
});

describe('sendMonitorFailedNotification', () => {
  it('resolves oversight-only recipients (no project)', async () => {
    await sendMonitorFailedNotification({ runId: 'run-1', runKind: 'status_monitor', reason: 'stale running run' });

    expect(recipients.resolveIncidentRecipients).toHaveBeenCalledWith(null);
    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'fleet.operational_monitor_failed' }));
  });

  it('is idempotent per run so repeat health checks do not resend', async () => {
    expect(buildMonitorFailedIdempotencyKey('status_monitor', 'run-1'))
      .toBe(buildMonitorFailedIdempotencyKey('status_monitor', 'run-1'));
    expect(buildMonitorFailedIdempotencyKey('status_monitor', 'run-1'))
      .not.toBe(buildMonitorFailedIdempotencyKey('status_monitor', 'run-2'));
  });

  it('records a failure when no oversight recipient exists', async () => {
    recipients.resolveIncidentRecipients.mockResolvedValue({ userIds: [], failed: true });

    const result = await sendMonitorFailedNotification({ runId: null, runKind: 'status_monitor', reason: 'no recent run found' });

    expect(bus.notify).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });
});
