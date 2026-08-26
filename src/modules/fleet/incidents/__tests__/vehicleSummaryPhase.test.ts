import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query }));

const recipientSvc = vi.hoisted(() => ({ resolveIncidentRecipients: vi.fn() }));
vi.mock('../recipientService', () => recipientSvc);

const notifications = vi.hoisted(() => ({
  sendVehicleMorningSummaryNotification: vi.fn(),
  VEHICLE_MORNING_SUMMARY_EVENT: 'fleet.operational_morning_summary',
}));
vi.mock('../incidentNotifications', () => notifications);

// `incidentGroupDelivery` is deliberately NOT mocked: the once-per-SAST-day guard IS its
// claim, so a mocked post would test nothing. Its two collaborators are mocked instead.
const idempotency = vi.hoisted(() => ({ claimNotification: vi.fn(), releaseNotificationClaim: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationIdempotency', () => idempotency);

const whatsapp = vi.hoisted(() => ({ sendWhatsAppGroup: vi.fn(), logDelivery: vi.fn() }));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => whatsapp);

import { buildVehicleSummaryMessage, runVehicleMorningSummaryPhase, VEHICLE_INCIDENT_TYPES } from '../vehicleSummaryPhase';
import type { VehicleIncidentCount } from '../vehicleSummaryPhase';
import { INCIDENT_TYPE_LABELS } from '../web/incidentLabels';

const OVERSIGHT_A = '55555555-5555-4555-8555-555555555555';
const OVERSIGHT_B = '66666666-6666-4666-8666-666666666666';

// 2026-08-31T06:15:00Z is 08:15:00 SAST on 2026-08-31, whose PREVIOUS SAST day is 2026-08-30.
const AT_0815 = { requestedAt: '2026-08-31T06:15:00.000Z', effectiveAt: '2026-08-31T06:15:00.000Z' };
const ONE_SECOND_EARLIER = { requestedAt: '2026-08-31T06:14:59.000Z', effectiveAt: '2026-08-31T06:14:59.000Z' };
// 22:30 UTC is already the NEXT SAST calendar day (00:30 SAST) — the gate must read SAST, not UTC.
const UTC_EVENING = { requestedAt: '2026-08-30T22:30:00.000Z', effectiveAt: '2026-08-30T22:30:00.000Z' };

function countRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    incident_type: 'severe_driving', severity: 'high',
    vehicle_registration: 'LN40MGGP', incident_count: 3, ...overrides,
  };
}

const ORIGINAL_JID = process.env.FLEET_ALERTS_WA_GROUP_JID;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FLEET_ALERTS_WA_GROUP_JID = '12036300000000000@g.us';
  db.query.mockResolvedValue([]);
  recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [OVERSIGHT_B, OVERSIGHT_A], failed: false });
  notifications.sendVehicleMorningSummaryNotification.mockResolvedValue({ delivered: 1, suppressed: 0, failed: 0 });
  whatsapp.sendWhatsAppGroup.mockResolvedValue(undefined);
  whatsapp.logDelivery.mockResolvedValue(undefined);
  const claimed = new Set<string>();
  idempotency.claimNotification.mockImplementation(async (userId: string, event: string, key: string) => {
    const composite = `${userId}|${event}|${key}`;
    if (claimed.has(composite)) return false;
    claimed.add(composite);
    return true;
  });
  idempotency.releaseNotificationClaim.mockImplementation(async (userId: string, event: string, key: string) => {
    claimed.delete(`${userId}|${event}|${key}`);
  });
});

afterEach(() => {
  if (ORIGINAL_JID === undefined) delete process.env.FLEET_ALERTS_WA_GROUP_JID;
  else process.env.FLEET_ALERTS_WA_GROUP_JID = ORIGINAL_JID;
});

describe('runVehicleMorningSummaryPhase — the 08:15 SAST gate', () => {
  it('skips entirely one second before 08:15 SAST', async () => {
    const result = await runVehicleMorningSummaryPhase(ONE_SECOND_EARLIER);
    expect(result).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('runs at exactly 08:15 SAST, one second later', async () => {
    const result = await runVehicleMorningSummaryPhase(AT_0815);
    expect(result).not.toBeNull();
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
  });

  // A UTC-based gate would read 22:30 as minute-of-day 1350 (>= 495) and fire; in SAST it is
  // 00:30 the next morning, hours before the summary is due.
  it('does not fire at 22:30 UTC, which is 00:30 SAST the next day', async () => {
    expect(await runVehicleMorningSummaryPhase(UTC_EVENING)).toBeNull();
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('summarises the PREVIOUS SAST day, bounded by SAST midnights', async () => {
    const result = await runVehicleMorningSummaryPhase(AT_0815);
    expect(result?.workDate).toBe('2026-08-30');
    const [, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe('2026-08-30T00:00:00+02:00');
    expect(params[2]).toBe('2026-08-31T00:00:00+02:00');
  });

  // The upper midnight belongs to the NEXT day. `<=` would double-count an incident detected
  // at exactly 00:00:00 SAST — it would appear in this summary and again in tomorrow's.
  it('takes the upper bound exclusively, so a midnight incident is counted once', async () => {
    await runVehicleMorningSummaryPhase(AT_0815);
    const [sql] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('detected_at >= $2::timestamptz');
    expect(sql).toContain('detected_at < $3::timestamptz');
    expect(sql).not.toContain('<= $3');
  });

  it('queries only vehicle incidents — staff-less, and the six telematics types', async () => {
    await runVehicleMorningSummaryPhase(AT_0815);
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('staff_id IS NULL');
    expect(params[0]).toEqual([
      'accident_sos', 'dangerous_area_entry', 'theft_after_hours_movement',
      'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving',
    ]);
  });
});

describe('runVehicleMorningSummaryPhase — once per SAST day', () => {
  it('posts to the group on the first tick and no-ops on every later tick that day', async () => {
    db.query.mockResolvedValue([countRow()]);
    const first = await runVehicleMorningSummaryPhase(AT_0815);
    const second = await runVehicleMorningSummaryPhase({
      requestedAt: '2026-08-31T06:20:00.000Z', effectiveAt: '2026-08-31T06:20:00.000Z',
    });

    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(first?.groupPostFailed).toBe(false);
    // Suppressed by the claim, not failed — the guard working is not an error.
    expect(second?.groupPostFailed).toBe(false);
  });

  it('anchors the claim on a stable recipient regardless of resolution order', async () => {
    await runVehicleMorningSummaryPhase(AT_0815);
    recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [OVERSIGHT_A, OVERSIGHT_B], failed: false });
    await runVehicleMorningSummaryPhase(AT_0815);
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
  });

  it('claims the vehicle summary under its own per-work-date key', async () => {
    await runVehicleMorningSummaryPhase(AT_0815);
    expect(idempotency.claimNotification).toHaveBeenCalledWith(
      OVERSIGHT_A, expect.stringContaining(':wa_group'), 'fleet-vehicle-morning-summary:2026-08-30',
    );
  });
});

describe('runVehicleMorningSummaryPhase — delivery accounting', () => {
  it('counts deliveries, not attempts', async () => {
    notifications.sendVehicleMorningSummaryNotification.mockResolvedValue({ delivered: 0, suppressed: 1, failed: 0 });
    const result = await runVehicleMorningSummaryPhase(AT_0815);
    expect(result?.delivered).toBe(0);
    expect(notifications.sendVehicleMorningSummaryNotification).toHaveBeenCalledTimes(2);
  });

  it('adds up real deliveries across recipients', async () => {
    const result = await runVehicleMorningSummaryPhase(AT_0815);
    expect(result?.delivered).toBe(2);
    expect(result?.failed).toBe(0);
  });

  it('still sends every per-recipient summary when the group post fails', async () => {
    whatsapp.sendWhatsAppGroup.mockRejectedValue(new Error('bridge unreachable'));
    const result = await runVehicleMorningSummaryPhase(AT_0815);

    expect(notifications.sendVehicleMorningSummaryNotification).toHaveBeenCalledTimes(2);
    expect(result?.delivered).toBe(2);
    expect(result?.failed).toBe(1); // the group post itself stays visible as a failure
    expect(result?.groupPostFailed).toBe(true);
  });

  it('releases the claim after a failed post so the next tick can retry', async () => {
    whatsapp.sendWhatsAppGroup.mockRejectedValueOnce(new Error('bridge unreachable'));
    await runVehicleMorningSummaryPhase(AT_0815);
    await runVehicleMorningSummaryPhase(AT_0815);
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(2);
  });

  it('records a failure and posts nothing when no recipient can be resolved', async () => {
    recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [], failed: true });
    const result = await runVehicleMorningSummaryPhase(AT_0815);
    expect(result?.failed).toBe(1);
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(logger.log.error).toHaveBeenCalled();
  });
});

describe('buildVehicleSummaryMessage', () => {
  const rows: VehicleIncidentCount[] = [
    { incidentType: 'severe_driving', severity: 'high', vehicleRegistration: 'LN40MGGP', count: 3 },
    { incidentType: 'theft_after_hours_movement', severity: 'critical', vehicleRegistration: 'KX22ABCD', count: 1 },
    { incidentType: 'severe_driving', severity: 'high', vehicleRegistration: 'KX22ABCD', count: 2 },
  ];

  it('breaks the day down by type with severity, and by vehicle', () => {
    const message = buildVehicleSummaryMessage('2026-08-30', rows);
    expect(message).toContain('2026-08-30');
    expect(message).toContain('severe driving');
    expect(message).toContain('high');
    expect(message).toContain('theft after hours movement');
    expect(message).toContain('critical');
    expect(message).toContain('LN40MGGP: 3');
    expect(message).toContain('KX22ABCD: 3');
    expect(message).toContain('Total: 6');
  });

  it('carries no personal information beyond the vehicle registration', () => {
    const message = buildVehicleSummaryMessage('2026-08-30', rows);
    expect(message).not.toMatch(/driver|staff|employee/i);
  });

  it('posts an all-clear plus the detector line on a day with zero incidents', () => {
    const message = buildVehicleSummaryMessage('2026-08-30', []);
    expect(message).toContain('No vehicle incidents');
    expect(message).toContain('Vehicle detectors:');
  });
});

describe('runVehicleMorningSummaryPhase — zero incidents', () => {
  it('still posts, because silence is indistinguishable from a broken cron', async () => {
    db.query.mockResolvedValue([]);
    const result = await runVehicleMorningSummaryPhase(AT_0815);

    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(String(whatsapp.sendWhatsAppGroup.mock.calls[0][1])).toContain('No vehicle incidents');
    expect(result?.totalIncidents).toBe(0);
    expect(result?.groupPostFailed).toBe(false);
  });

  it('still sends the per-recipient summaries on a zero-incident day', async () => {
    await runVehicleMorningSummaryPhase(AT_0815);
    expect(notifications.sendVehicleMorningSummaryNotification).toHaveBeenCalledTimes(2);
  });
});

// The JID is unset by default in every environment — that is the documented rollback path,
// and a configuration state rather than a failure. The digest must still reach people.
describe('runVehicleMorningSummaryPhase — with no group JID configured', () => {
  beforeEach(() => { delete process.env.FLEET_ALERTS_WA_GROUP_JID; });

  it('posts nothing to the group but still sends every per-recipient summary', async () => {
    const result = await runVehicleMorningSummaryPhase(AT_0815);

    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(notifications.sendVehicleMorningSummaryNotification).toHaveBeenCalledTimes(2);
    expect(result?.delivered).toBe(2);
    expect(result?.groupPostFailed).toBe(false); // unset is configuration, not failure
    expect(result?.failed).toBe(0);
  });
});

// The first version of this line named four detectors while the query already covered six,
// so the message under-reported what was being watched and nobody could tell from reading it.
describe('the detector line is derived from the type list, never hand-written', () => {
  it('names every type the query actually counts', () => {
    const message = buildVehicleSummaryMessage('2026-08-30', []);
    const detectorLine = message.split('\n').find((line) => line.startsWith('Vehicle detectors:'));

    expect(detectorLine).toBeDefined();
    expect(VEHICLE_INCIDENT_TYPES).toHaveLength(6);
    for (const type of VEHICLE_INCIDENT_TYPES) {
      expect(detectorLine).toContain(INCIDENT_TYPE_LABELS[type]);
    }
  });

  // Pins the derivation itself: a hand-written line naming a subset passes the loop above only
  // by luck of substrings, but cannot carry exactly as many comma-separated labels as there are types.
  it('carries exactly one label per type, so a hardcoded subset cannot pass', () => {
    const message = buildVehicleSummaryMessage('2026-08-30', []);
    const detectorLine = message.split('\n').find((line) => line.startsWith('Vehicle detectors:')) ?? '';
    const labels = detectorLine.replace('Vehicle detectors: ', '').split(', ');

    expect(labels).toHaveLength(VEHICLE_INCIDENT_TYPES.length);
    expect(labels).toEqual(VEHICLE_INCIDENT_TYPES.map((type) => INCIDENT_TYPE_LABELS[type]));
  });

  it('appears on a day with incidents too, not only on an all-clear', () => {
    const message = buildVehicleSummaryMessage('2026-08-30', [
      { incidentType: 'severe_driving', severity: 'high', vehicleRegistration: 'LN40MGGP', count: 1 },
    ]);
    expect(message).toContain('Vehicle detectors:');
  });
});
