import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const wa = vi.hoisted(() => ({ sendWhatsAppGroup: vi.fn(), deliverWhatsApp: vi.fn() }));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => wa);

const idem = vi.hoisted(() => ({ claimNotification: vi.fn(), releaseNotificationClaim: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationIdempotency', () => idem);

const bus = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationBus', () => bus);

const recipients = vi.hoisted(() => ({ resolveIncidentRecipients: vi.fn() }));
vi.mock('../recipientService', () => recipients);

import { buildFleetAlertsMessage, postToFleetAlertsGroup } from '../incidentGroupDelivery';
import type { FleetAlertsGroupIncident } from '../incidentGroupDelivery';
import { sendEscalationNotification } from '../incidentNotifications';

const INCIDENT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
// Deliberately NOT in sorted order: the claim holder must be order-independent.
const PM = '99999999-9999-4999-8999-999999999999';
const OVERSIGHT = '44444444-4444-4444-8444-444444444444';
const JID = '120363000000000000@g.us';
const EVENT = 'fleet.operational_incident_escalated';
const KEY = `fleet-incident-escalated:${INCIDENT}:1`;

let dmFailures: number;

function incident(overrides: Partial<FleetAlertsGroupIncident> = {}): FleetAlertsGroupIncident {
  return {
    incidentId: INCIDENT,
    incidentReference: 'INC-ACCSOS-20260818-ABC123',
    incidentType: 'accident_sos',
    vehicleRegistration: 'JX 12 AB GP',
    projectName: 'Project One',
    detectedAt: '2026-08-18T08:05:00.000Z',
    eventType: EVENT,
    idempotencyKey: KEY,
    recipientUserIds: [PM, OVERSIGHT],
    deliverToRecipients: vi.fn(async () => dmFailures),
    ...overrides,
  };
}

async function post(overrides: Partial<FleetAlertsGroupIncident> = {}): Promise<number> {
  const input = incident(overrides);
  return postToFleetAlertsGroup(input, buildFleetAlertsMessage(input));
}

beforeEach(() => {
  vi.clearAllMocks();
  dmFailures = 0;
  process.env.FLEET_ALERTS_WA_GROUP_JID = JID;
  wa.sendWhatsAppGroup.mockResolvedValue(undefined);
  wa.deliverWhatsApp.mockResolvedValue(undefined);
  idem.claimNotification.mockResolvedValue(true);
  idem.releaseNotificationClaim.mockResolvedValue(undefined);
  bus.notify.mockResolvedValue({ delivered: 2, suppressed: 0, failed: 0 });
  recipients.resolveIncidentRecipients.mockResolvedValue({ userIds: [PM, OVERSIGHT], failed: false });
});

describe('buildFleetAlertsMessage', () => {
  it('carries the reference, type label, registration, project, SAST time, and the review link', () => {
    const message = buildFleetAlertsMessage(incident());

    expect(message).toContain('INC-ACCSOS-20260818-ABC123');
    expect(message).toContain('accident sos');
    expect(message).toContain('JX 12 AB GP');
    expect(message).toContain('Project One');
    // 08:05 UTC is 10:05 SAST — identical whatever TZ the process runs in.
    expect(message).toContain('2026-08-18 10:05 SAST');
    expect(message).toContain('/fleet/incidents');
  });

  it('names no driver and no coordinates', () => {
    const message = buildFleetAlertsMessage(incident()).toLowerCase();

    expect(message).not.toContain('driver');
    expect(message).not.toContain('latitude');
    expect(message).not.toContain('lat:');
  });

  it('renders unknown snapshots without printing null or undefined', () => {
    const message = buildFleetAlertsMessage(incident({
      incidentReference: null, vehicleRegistration: null, projectName: null,
    }));

    expect(message).not.toMatch(/null|undefined/);
  });
});

describe('postToFleetAlertsGroup', () => {
  it('posts to the Fleet Alerts group once and does not DM anybody', async () => {
    const failed = await post();

    expect(wa.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(wa.sendWhatsAppGroup).toHaveBeenCalledWith(JID, expect.stringContaining('INC-ACCSOS-20260818-ABC123'));
    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
    expect(failed).toBe(0);
  });

  it('claims in its own `:wa_group` namespace, never the per-user `:whatsapp` one', async () => {
    await post();

    expect(idem.claimNotification).toHaveBeenCalledTimes(1);
    expect(idem.claimNotification).toHaveBeenCalledWith(expect.any(String), `${EVENT}:wa_group`, KEY);
    expect(idem.claimNotification).not.toHaveBeenCalledWith(expect.any(String), `${EVENT}:whatsapp`, KEY);
  });

  it('anchors the claim on the same holder regardless of recipient order', async () => {
    await post({ recipientUserIds: [PM, OVERSIGHT] });
    const first = idem.claimNotification.mock.calls[0]?.[0];
    idem.claimNotification.mockClear();

    await post({ recipientUserIds: [OVERSIGHT, PM] });

    expect(idem.claimNotification.mock.calls[0]?.[0]).toBe(first);
  });

  it('suppresses the second post for the same incident', async () => {
    idem.claimNotification.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await post();
    const second = await post();

    expect(wa.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
    expect(first).toBe(0);
    expect(second).toBe(0);
  });

  it('posts anyway when the claim itself throws (fail-open) and never throws at the caller', async () => {
    idem.claimNotification.mockRejectedValue(new Error('claims table unreachable'));

    const failed = await post();

    expect(wa.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(failed).toBe(0);
    expect(logger.log.error).toHaveBeenCalled();
  });

  it('falls back to the per-user DM path when the group send throws, counting the group failure', async () => {
    wa.sendWhatsAppGroup.mockRejectedValue(new Error('HTTP 502 — bridge down'));
    const input = incident();

    const failed = await postToFleetAlertsGroup(input, buildFleetAlertsMessage(input));

    expect(input.deliverToRecipients).toHaveBeenCalledTimes(1);
    expect(failed).toBeGreaterThan(0);
    expect(idem.releaseNotificationClaim).toHaveBeenCalledWith(expect.any(String), `${EVENT}:wa_group`, KEY);
  });

  it('adds the DM failures to the group failure', async () => {
    wa.sendWhatsAppGroup.mockRejectedValue(new Error('bridge down'));
    dmFailures = 2;

    await expect(post()).resolves.toBe(3);
  });

  it('falls back with a warning and no failure count when the JID is unset', async () => {
    delete process.env.FLEET_ALERTS_WA_GROUP_JID;
    const input = incident();

    const failed = await postToFleetAlertsGroup(input, buildFleetAlertsMessage(input));

    expect(wa.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(idem.claimNotification).not.toHaveBeenCalled();
    expect(input.deliverToRecipients).toHaveBeenCalledTimes(1);
    expect(failed).toBe(0);
    expect(logger.log.warn).toHaveBeenCalled();
  });

  it('treats a blank JID as unset', async () => {
    process.env.FLEET_ALERTS_WA_GROUP_JID = '   ';

    await post();

    expect(wa.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(logger.log.warn).toHaveBeenCalled();
  });
});

describe('wiring into the mandatory-WhatsApp site', () => {
  const escalation = {
    incidentId: INCIDENT, incidentReference: 'INC-ACCSOS-20260818-ABC123',
    incidentType: 'accident_sos' as const, severity: 'critical' as const,
    producerKind: 'source_event' as const, projectId: PROJECT, staffName: 'Jane Driver',
    projectName: 'Project One', operationalSiteName: 'Site One', escalationLevel: 1,
    vehicleRegistration: 'JX 12 AB GP', detectedAt: '2026-08-18T08:05:00.000Z',
  };

  it('sends a critical source-event incident to the group instead of DMs', async () => {
    const result = await sendEscalationNotification(escalation);

    expect(wa.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
    expect(result.failed).toBe(0);
  });

  it('never reaches the group for a high-severity source event', async () => {
    await sendEscalationNotification({ ...escalation, severity: 'high' });

    expect(wa.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('never reaches the group for a critical scheduled detection', async () => {
    await sendEscalationNotification({ ...escalation, producerKind: 'scheduled_detection' });

    expect(wa.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(wa.deliverWhatsApp).not.toHaveBeenCalled();
  });

  it('DMs every recipient under the per-user claim when the group post fails', async () => {
    wa.sendWhatsAppGroup.mockRejectedValue(new Error('bridge down'));

    const result = await sendEscalationNotification(escalation);

    expect(wa.deliverWhatsApp).toHaveBeenCalledTimes(2);
    expect(idem.claimNotification).toHaveBeenCalledWith(PM, `${EVENT}:whatsapp`, KEY);
    expect(idem.claimNotification).toHaveBeenCalledWith(OVERSIGHT, `${EVENT}:whatsapp`, KEY);
    expect(result.failed).toBe(1);
  });
});
