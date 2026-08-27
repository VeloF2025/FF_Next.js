import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const bus = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationBus', () => bus);

// sendWhatsAppGroup and logDelivery are mocked even though most of this file
// exercises the DM path: the module under test imports the group path too, and
// a mock missing them turns a group post into a TypeError that the group
// module's own catch swallows into the fallback — every DM assertion below
// would then pass for the wrong reason on a machine that has the JID set.
const wa = vi.hoisted(() => ({ deliverWhatsApp: vi.fn(), sendWhatsAppGroup: vi.fn(), logDelivery: vi.fn() }));
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
  buildVehicleMorningSummaryIdempotencyKey,
  sendVehicleMorningSummaryNotification,
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

// This file pins the per-user DM leg, which only runs when no group is
// configured. A developer or CI box with FLEET_ALERTS_WA_GROUP_JID exported
// would otherwise silently exercise the group path instead — see the
// both-modes tests at the end for the configured case.
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FLEET_ALERTS_WA_GROUP_JID;
  recipients.resolveIncidentRecipients.mockResolvedValue({ userIds: [PM, OVERSIGHT], failed: false });
  bus.notify.mockResolvedValue({ delivered: 2, suppressed: 0, failed: 0 });
  wa.deliverWhatsApp.mockResolvedValue(undefined);
  wa.sendWhatsAppGroup.mockResolvedValue(undefined);
  wa.logDelivery.mockResolvedValue(undefined);
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

  it('names the VEHICLE in the body when the incident has no staff member', async () => {
    // A telematics incident never has one, and "Unknown staff — Unassigned
    // project — review required" is indistinguishable from a bug at the
    // receiving end. Asserted on the rendered body, not on the input.
    await sendIncidentOpenedNotification({
      ...baseInput, incidentType: 'theft_after_hours_movement', producerKind: 'source_event',
      staffName: null, projectName: null, operationalSiteName: null,
      vehicleRegistration: 'ABC 123 GP', reasonCodes: [],
    });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: 'ABC 123 GP — Unassigned project — review required',
    }));
  });

  it('names the driver AND the vehicle when both are known', async () => {
    // Driver attribution made "both known" the normal case for a telematics
    // incident, and for a non-critical type this body is the whole alert —
    // there is no WhatsApp leg and no other vehicle field. Naming only the
    // driver leaves the reader guessing which of eighteen vehicles it was.
    await sendIncidentOpenedNotification({ ...baseInput, vehicleRegistration: 'ABC 123 GP' });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Jane Driver (ABC 123 GP) — Site One — attendance_late',
    }));
  });

  it('names the staff member alone when the incident has no vehicle', async () => {
    // The roster path: no registration exists, and an empty bracket would be
    // worse than none.
    await sendIncidentOpenedNotification({ ...baseInput, vehicleRegistration: null });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Jane Driver — Site One — attendance_late',
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

  it('DMs every recipient for a critical source-event incident when no Fleet Alerts group is configured, in addition to notify()', async () => {
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

  it('still sends when the claim itself throws, rather than letting bookkeeping suppress a critical alert', async () => {
    // This module's contract is that failures are counted in NotifyResult, never thrown. A
    // claim error must not propagate out, and must not cost the recipient the one channel a
    // critical incident is guaranteed to reach — delivering twice beats not delivering.
    idem.claimNotification.mockRejectedValueOnce(new Error('claims table unavailable'));

    const result = await sendIncidentOpenedNotification({
      ...baseInput, producerKind: 'source_event', severity: 'critical', incidentType: 'accident_sos',
      rule: rule({ incidentType: 'accident_sos', severity: 'critical' }),
    });

    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(PM, expect.anything(), null);
    expect(result).toEqual(expect.objectContaining({ failed: expect.any(Number) }));
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
    vehicleRegistration: 'JX 12 AB GP', detectedAt: '2026-08-18T08:00:00.000Z',
  };

  it('uses the incident id + escalation level idempotency key', async () => {
    await sendEscalationNotification(input);

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'fleet.operational_incident_escalated',
      idempotency_key: `fleet-incident-escalated:${INCIDENT}:2`,
    }));
  });

  it('names the VEHICLE in the escalation body when there is no staff member', async () => {
    // These are exactly the incidents that DO escalate: a vehicle cannot
    // acknowledge, so a telematics incident reaches level 1 by construction.
    await sendEscalationNotification({
      ...input, incidentType: 'theft_after_hours_movement', producerKind: 'source_event',
      staffName: null, projectName: null, operationalSiteName: null,
      vehicleRegistration: 'ABC 123 GP',
    });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: 'ABC 123 GP — Unassigned project — still unacknowledged at escalation level 2',
    }));
  });

  it('names the driver AND the vehicle in an escalation when both are known', async () => {
    // An escalation naming a driver but not the vehicle sends somebody looking
    // for the wrong van.
    await sendEscalationNotification(input);

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Jane Driver (JX 12 AB GP) — Site One — still unacknowledged at escalation level 2',
    }));
  });

  it('names the staff member alone in an escalation when there is no vehicle', async () => {
    await sendEscalationNotification({ ...input, vehicleRegistration: null });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      body: 'Jane Driver — Site One — still unacknowledged at escalation level 2',
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

  it('DMs every recipient for a critical source-event escalation when no Fleet Alerts group is configured', async () => {
    await sendEscalationNotification({ ...input, severity: 'critical', producerKind: 'source_event', incidentType: 'accident_sos' });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'fleet.operational_incident_escalated' }));
    expect(wa.deliverWhatsApp).toHaveBeenCalledTimes(2);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(PM, expect.anything(), null);
    expect(wa.deliverWhatsApp).toHaveBeenCalledWith(OVERSIGHT, expect.anything(), null);
  });

  it('posts to the group instead of DMing when a Fleet Alerts group IS configured', async () => {
    process.env.FLEET_ALERTS_WA_GROUP_JID = '120363000000000000@g.us';

    const result = await sendEscalationNotification({ ...input, severity: 'critical', producerKind: 'source_event' });

    expect(wa.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
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

    const result = await sendMonitorFailedNotification({
      runId: null, occurrenceKey: 'missing:2026-08-20', runKind: 'status_monitor', reason: 'no recent run found',
    });

    expect(bus.notify).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  // `user_notifications.source_id` is a uuid column (migration 192, line 20). notify()
  // writes it as-is, so a non-uuid reference raises 22P02 there — and because the in-app
  // insert, the email dispatch, and the WhatsApp dispatch all live inside the same try
  // block, that single throw loses ALL THREE channels for the one alert registered with
  // `{ in_app: true, email: true, whatsapp: true }`. The missing-run branch of the health
  // check is exactly that alert, so a non-uuid `source_id` there means the "the monitor is
  // dead" page can never be delivered by any channel.
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function notifyLikePostgres(): (payload: { source_id?: string }) => Promise<{ delivered: number; suppressed: number; failed: number }> {
    return async (payload) => {
      if (payload.source_id !== undefined && !UUID_PATTERN.test(payload.source_id)) {
        throw new Error(`invalid input syntax for type uuid: "${payload.source_id}"`);
      }
      return { delivered: 3, suppressed: 0, failed: 0 };
    };
  }

  it('delivers a missing-run alert on every channel instead of losing all three to a uuid cast', async () => {
    bus.notify.mockImplementation(notifyLikePostgres());

    const result = await sendMonitorFailedNotification({
      runId: null, occurrenceKey: 'missing:2026-08-20', runKind: 'status_monitor',
      reason: 'No Fleet status-monitor run has started recently.',
    });

    expect(result).toEqual({ delivered: 3, suppressed: 0, failed: 0 });
    expect(bus.notify.mock.calls[0]?.[0]?.source_id).toBeUndefined();
    expect(logger.log.error).not.toHaveBeenCalled();
  });

  // Defence in depth: the discriminated input type forbids a non-uuid `runId`, but a type
  // cannot stop a cast or a JavaScript caller. Since the cost of one slipping through is
  // total, silent loss of the alert on all three channels, the runtime must refuse to put a
  // non-uuid in `source_id` too — dropping it to metadata and warning, never crashing.
  it('refuses to put a non-uuid runId in source_id even when a caller supplies one', async () => {
    bus.notify.mockImplementation(notifyLikePostgres());

    const result = await sendMonitorFailedNotification({
      runId: 'missing:2026-08-20' as string, runKind: 'status_monitor', reason: 'no recent run found',
    });

    expect(result).toEqual({ delivered: 3, suppressed: 0, failed: 0 });
    expect(bus.notify.mock.calls[0]?.[0]?.source_id).toBeUndefined();
    expect(bus.notify.mock.calls[0]?.[0]?.metadata).toEqual(expect.objectContaining({ runId: 'missing:2026-08-20' }));
    expect(logger.log.warn).toHaveBeenCalled();
  });

  it('keeps the missing-run reference in metadata rather than losing it with source_id', async () => {
    await sendMonitorFailedNotification({
      runId: null, occurrenceKey: 'missing:2026-08-20', runKind: 'status_monitor', reason: 'no recent run found',
    });

    expect(bus.notify).toHaveBeenCalledWith(expect.objectContaining({
      source_id: undefined,
      metadata: expect.objectContaining({ runKind: 'status_monitor', runId: null, occurrenceKey: 'missing:2026-08-20' }),
    }));
  });

  it('still passes a real run uuid straight through as source_id for the stale-run branch', async () => {
    bus.notify.mockImplementation(notifyLikePostgres());

    const result = await sendMonitorFailedNotification({ runId: INCIDENT, runKind: 'status_monitor', reason: 'stale running run' });

    expect(result.failed).toBe(0);
    expect(bus.notify.mock.calls[0]?.[0]?.source_id).toBe(INCIDENT);
  });

  // A constant "missing" reference would dedupe the alert for ever after the first day it
  // fires — worse than the crash it replaces, because it fails silently.
  it('dedupes the missing-run alert per day, never permanently', () => {
    expect(buildMonitorFailedIdempotencyKey('status_monitor', 'missing:2026-08-20'))
      .toBe(buildMonitorFailedIdempotencyKey('status_monitor', 'missing:2026-08-20'));
    expect(buildMonitorFailedIdempotencyKey('status_monitor', 'missing:2026-08-20'))
      .not.toBe(buildMonitorFailedIdempotencyKey('status_monitor', 'missing:2026-08-21'));
  });
});

// PR8. The roster summary renders a null project as the literal `unassigned`, and vehicle
// incidents are projectless too — so if the vehicle summary reused that builder the two
// digests would produce the SAME key for the same recipient and date, and claimNotification
// would silently drop whichever ran second. These must never collide, for any project id.
describe('vehicle morning-summary keys never collide with the roster summary', () => {
  const WORK_DATE = '2026-08-30';

  it('uses a distinct namespace from the roster summary, including its unassigned bucket', () => {
    const vehicleKey = buildVehicleMorningSummaryIdempotencyKey(PM, WORK_DATE);
    expect(vehicleKey).toBe(`fleet-vehicle-morning-summary:${PM}:${WORK_DATE}`);
    for (const projectId of [null, PROJECT, 'unassigned', '']) {
      expect(buildMorningSummaryIdempotencyKey(PM, projectId, WORK_DATE)).not.toBe(vehicleKey);
    }
  });

  it('cannot be confused by prefix either way', () => {
    const rosterKey = buildMorningSummaryIdempotencyKey(PM, null, WORK_DATE);
    const vehicleKey = buildVehicleMorningSummaryIdempotencyKey(PM, WORK_DATE);
    expect(vehicleKey.startsWith('fleet-morning-summary:')).toBe(false);
    expect(rosterKey.startsWith('fleet-vehicle-morning-summary:')).toBe(false);
  });

  it('separates recipients and work dates', () => {
    expect(buildVehicleMorningSummaryIdempotencyKey(PM, WORK_DATE))
      .not.toBe(buildVehicleMorningSummaryIdempotencyKey(PM, '2026-08-29'));
    expect(buildVehicleMorningSummaryIdempotencyKey(PM, WORK_DATE))
      .not.toBe(buildVehicleMorningSummaryIdempotencyKey(INCIDENT, WORK_DATE));
  });

  it('sends a zero-incident summary rather than nothing', async () => {
    bus.notify.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });

    await sendVehicleMorningSummaryNotification({ recipientUserId: PM, workDate: WORK_DATE, items: [] });

    const payload = bus.notify.mock.calls[0]?.[0];
    expect(payload?.body).toContain('No vehicle incidents');
    expect(payload?.metadata?.summaryScope).toBe('vehicle');
  });
});
