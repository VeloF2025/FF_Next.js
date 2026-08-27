import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/logger', () => logger);

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@/lib/db-pool', () => ({ query: db.query }));

const recipientSvc = vi.hoisted(() => ({ resolveIncidentRecipients: vi.fn() }));
vi.mock('../recipientService', () => recipientSvc);

const notifications = vi.hoisted(() => ({ VEHICLE_MORNING_SUMMARY_EVENT: 'fleet.operational_morning_summary' }));
vi.mock('../incidentNotifications', () => notifications);

// `incidentGroupDelivery` is deliberately NOT mocked: the once-per-week guard IS its claim, so a
// mocked post would test nothing at all. Its two collaborators are mocked instead.
const idempotency = vi.hoisted(() => ({ claimNotification: vi.fn(), releaseNotificationClaim: vi.fn() }));
vi.mock('@/modules/notifications/services/notificationIdempotency', () => idempotency);

const whatsapp = vi.hoisted(() => ({ sendWhatsAppGroup: vi.fn(), logDelivery: vi.fn() }));
vi.mock('@/modules/notifications/services/whatsappDelivery', () => whatsapp);

import { runWeeklyDigestPhase, weeklyDigestIsDue, weeklyDigestWindow } from '../weeklyDigestPhase';
import { buildWeeklyDigestMessage } from '../weeklyDigestMessage';
import type { WeeklyVehicleTotals } from '../weeklyDigestQueries';
import type { IncidentType } from '../types';

const OVERSIGHT_A = '55555555-5555-4555-8555-555555555555';
const OVERSIGHT_B = '66666666-6666-4666-8666-666666666666';

// 2026-08-24 is a Monday. SAST is UTC+2, so 06:30:00Z that day is 08:30:00 SAST, and the week it
// summarises is Monday 2026-08-17 through Sunday 2026-08-23.
const MONDAY_0830 = { requestedAt: '2026-08-24T06:30:00.000Z', effectiveAt: '2026-08-24T06:30:00.000Z' };
const MONDAY_0829 = { requestedAt: '2026-08-24T06:29:00.000Z', effectiveAt: '2026-08-24T06:29:00.000Z' };
const MONDAY_0831 = { requestedAt: '2026-08-24T06:31:00.000Z', effectiveAt: '2026-08-24T06:31:00.000Z' };
const SUNDAY_2359 = { requestedAt: '2026-08-23T21:59:00.000Z', effectiveAt: '2026-08-23T21:59:00.000Z' };
// 22:35Z on Sunday is already 00:35 SAST on Monday — a SAST Monday, but hours before 08:30.
const SUNDAY_UTC_LATE = { requestedAt: '2026-08-23T22:35:00.000Z', effectiveAt: '2026-08-23T22:35:00.000Z' };
// 22:35Z on MONDAY is 00:35 SAST on TUESDAY. A UTC weekday reads "Monday, minute 1355 >= 510" and
// fires a second digest; in SAST the digest Monday is over.
const MONDAY_UTC_LATE = { requestedAt: '2026-08-24T22:35:00.000Z', effectiveAt: '2026-08-24T22:35:00.000Z' };

function vehicleRow(overrides: Record<string, unknown> = {}) {
  return {
    vehicle_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', registration: 'LN40MGGP',
    reporting_days: 7, distance_km: '812.40', ignition_days: 7, ignition_seconds: '77400',
    harsh_days: 5, harsh_events: 14, ...overrides,
  };
}

function totals(overrides: Partial<WeeklyVehicleTotals> = {}): WeeklyVehicleTotals {
  return {
    vehicleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', registration: 'LN40MGGP', reportingDays: 7,
    distanceKm: 812.4, ignitionDays: 7, ignitionSeconds: 77_400, harshDays: 5, harshEvents: 14, ...overrides,
  };
}

/** Both aggregates land on the same mocked `query`; the statement's own comment tag routes them. */
function mockQueries(vehicles: unknown[] = [], incidents: unknown[] = []): void {
  db.query.mockImplementation(async (sql: string) => (
    sql.includes('fleet-weekly-digest:vehicle-totals') ? vehicles : incidents
  ));
}

function vehicleCall(): [string, unknown[]] {
  const call = db.query.mock.calls.find((c) => String(c[0]).includes('vehicle-totals'));
  return call as [string, unknown[]];
}

function incidentCall(): [string, unknown[]] {
  const call = db.query.mock.calls.find((c) => String(c[0]).includes('incident-counts'));
  return call as [string, unknown[]];
}

const ORIGINAL_JID = process.env.FLEET_ALERTS_WA_GROUP_JID;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FLEET_ALERTS_WA_GROUP_JID = '12036300000000000@g.us';
  mockQueries();
  recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [OVERSIGHT_B, OVERSIGHT_A], failed: false });
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

describe('the Monday 08:30 SAST gate', () => {
  it('does not fire at 23:59 SAST on Sunday', async () => {
    expect(weeklyDigestIsDue(SUNDAY_2359.effectiveAt)).toBe(false);
    expect(await runWeeklyDigestPhase(SUNDAY_2359)).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('does not fire at 08:29 SAST on Monday, one minute early', async () => {
    expect(await runWeeklyDigestPhase(MONDAY_0829)).toBeNull();
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('fires at exactly 08:30 SAST on Monday', async () => {
    const result = await runWeeklyDigestPhase(MONDAY_0830);
    expect(result).not.toBeNull();
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
  });

  it('fires at 08:31 SAST on Monday', async () => {
    expect(await runWeeklyDigestPhase(MONDAY_0831)).not.toBeNull();
  });

  // Both halves of the gate must be read in SAST, and each direction breaks differently.
  it('does not fire at 00:35 SAST Monday, though the SAST weekday already says Monday', async () => {
    expect(await runWeeklyDigestPhase(SUNDAY_UTC_LATE)).toBeNull();
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
  });

  it('does not fire at 22:35 UTC Monday, which is 00:35 SAST on Tuesday', async () => {
    // A UTC weekday reads this as Monday at minute 1355 and fires a whole second digest.
    expect(weeklyDigestIsDue(MONDAY_UTC_LATE.effectiveAt)).toBe(false);
    expect(await runWeeklyDigestPhase(MONDAY_UTC_LATE)).toBeNull();
  });

  it('does not fire on a Tuesday morning at the same time of day', async () => {
    expect(weeklyDigestIsDue('2026-08-25T06:30:00.000Z')).toBe(false);
  });
});

describe('the week window — previous Monday 00:00 SAST up to, but not including, this Monday', () => {
  it('summarises Monday to Sunday of the completed week', () => {
    expect(weeklyDigestWindow('2026-08-24')).toEqual({
      weekStart: '2026-08-17', weekEnd: '2026-08-23', weekEndExclusive: '2026-08-24',
    });
  });

  it('bounds the vehicle-day aggregate on those SAST dates', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    const [, params] = vehicleCall();
    expect(params[0]).toBe('2026-08-17');
    expect(params[1]).toBe('2026-08-24');
  });

  it('bounds the incident count on SAST midnights, written as explicit +02:00 offsets', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    const [, params] = incidentCall();
    expect(params[1]).toBe('2026-08-17T00:00:00+02:00');
    expect(params[2]).toBe('2026-08-24T00:00:00+02:00');
  });

  // The upper bound belongs to the NEXT week. `<=` counts the digest morning's own Monday here
  // and again in next Monday's digest.
  it('takes the upper bound exclusively in both statements', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    const [vehicleSql] = vehicleCall();
    const [incidentSql] = incidentCall();

    expect(vehicleSql).toContain('s.work_date >= $1::date');
    expect(vehicleSql).toContain('s.work_date < $2::date');
    expect(vehicleSql).not.toContain('<= $2');
    expect(incidentSql).toContain('detected_at >= $2::timestamptz');
    expect(incidentSql).toContain('detected_at < $3::timestamptz');
    expect(incidentSql).not.toContain('<= $3');
  });

  it('counts only the vehicle-level incident types, staff-less', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    const [sql, params] = incidentCall();
    expect(sql).toContain('staff_id IS NULL');
    expect(params[0]).toEqual([
      'theft_after_hours_movement', 'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving',
    ]);
  });

  // Two active trackers on one vehicle would fan the LEFT JOIN into two rows and double its
  // weekly distance. A digest that overstates the fleet's kilometres is a broken digest.
  it('tests tracker activity with EXISTS rather than joining the trackers table', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    const [sql] = vehicleCall();
    expect(sql).toContain('EXISTS (SELECT 1 FROM fleet_vehicle_trackers');
    expect(sql).not.toMatch(/JOIN\s+fleet_vehicle_trackers/);
  });
});

describe('once per week', () => {
  it('posts on the first Monday tick and no-ops on every later tick that morning', async () => {
    const first = await runWeeklyDigestPhase(MONDAY_0830);
    const second = await runWeeklyDigestPhase(MONDAY_0831);

    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
    expect(first?.delivered).toBe(1);
    // Suppressed by the claim, not failed — and NOT a delivery: counting it as one would report
    // the digest as freshly sent on every tick for the rest of the day.
    expect(second?.delivered).toBe(0);
    expect(second?.failed).toBe(0);
    expect(second?.groupPostFailed).toBe(false);
  });

  it('claims the week under the Monday that OPENS the week summarised, not the tick date', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    expect(idempotency.claimNotification).toHaveBeenCalledWith(
      OVERSIGHT_A, expect.stringContaining(':wa_group'), 'fleet-weekly-digest:2026-08-17',
    );
    // A per-day key would name 2026-08-24 — the day it was sent — and two different weeks could
    // never be told apart by the key a reader goes looking for.
    const keys = idempotency.claimNotification.mock.calls.map((call) => call[2]);
    expect(keys).not.toContain('fleet-weekly-digest:2026-08-24');
  });

  it('posts again the following Monday, under that week’s own key', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    await runWeeklyDigestPhase({
      requestedAt: '2026-08-31T06:30:00.000Z', effectiveAt: '2026-08-31T06:30:00.000Z',
    });

    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(2);
    const keys = idempotency.claimNotification.mock.calls.map((call) => call[2]);
    expect(keys).toEqual(['fleet-weekly-digest:2026-08-17', 'fleet-weekly-digest:2026-08-24']);
  });

  it('anchors the claim on a stable recipient regardless of resolution order', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [OVERSIGHT_A, OVERSIGHT_B], failed: false });
    await runWeeklyDigestPhase(MONDAY_0831);
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
  });

  it('releases the claim after a failed post so the next tick retries the same week', async () => {
    whatsapp.sendWhatsAppGroup.mockRejectedValueOnce(new Error('bridge unreachable'));
    const failedTick = await runWeeklyDigestPhase(MONDAY_0830);
    const retry = await runWeeklyDigestPhase(MONDAY_0831);

    expect(failedTick?.groupPostFailed).toBe(true);
    expect(failedTick?.failed).toBe(1);
    expect(failedTick?.delivered).toBe(0);
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(2);
    expect(retry?.delivered).toBe(1);
    expect(retry?.groupPostFailed).toBe(false);
  });
});

describe('group-only delivery', () => {
  it('sends no per-user DMs — not on a successful post, and not on a failed one', async () => {
    await runWeeklyDigestPhase(MONDAY_0830);
    // The next Monday, not a later tick of this one: a claim-suppressed tick never reaches the
    // bridge, so the rejection queued below would go unconsumed and leak into the next test.
    whatsapp.sendWhatsAppGroup.mockRejectedValueOnce(new Error('bridge unreachable'));
    await runWeeklyDigestPhase({ requestedAt: '2026-08-31T06:30:00.000Z', effectiveAt: '2026-08-31T06:30:00.000Z' });

    const dmSends = whatsapp.logDelivery.mock.calls.filter((call) => call[4] !== '12036300000000000@g.us');
    expect(dmSends).toHaveLength(0);
  });

  it('warns and skips with no group JID configured, without burning the week’s claim', async () => {
    delete process.env.FLEET_ALERTS_WA_GROUP_JID;
    const skipped = await runWeeklyDigestPhase(MONDAY_0830);

    expect(skipped).toMatchObject({ delivered: 0, failed: 0, skippedNoGroupJid: true, groupPostFailed: false });
    expect(logger.log.warn).toHaveBeenCalled();
    expect(idempotency.claimNotification).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();

    // Configuring the JID mid-morning must still get that week's digest out.
    process.env.FLEET_ALERTS_WA_GROUP_JID = '12036300000000000@g.us';
    const configured = await runWeeklyDigestPhase(MONDAY_0831);
    expect(configured?.delivered).toBe(1);
    expect(whatsapp.sendWhatsAppGroup).toHaveBeenCalledTimes(1);
  });

  it('posts nothing and records a failure when no recipient can be resolved', async () => {
    recipientSvc.resolveIncidentRecipients.mockResolvedValue({ userIds: [], failed: true });
    const result = await runWeeklyDigestPhase(MONDAY_0830);

    expect(result?.failed).toBe(1);
    expect(result?.delivered).toBe(0);
    expect(whatsapp.sendWhatsAppGroup).not.toHaveBeenCalled();
    expect(logger.log.error).toHaveBeenCalled();
  });
});

describe('the message the group actually receives', () => {
  it('carries the fleet totals, the top lists and the details link', async () => {
    mockQueries(
      [vehicleRow(), vehicleRow({
        vehicle_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', registration: 'KX22ABCD',
        distance_km: '120.00', harsh_events: 2, harsh_days: 3,
      })],
      [{ incident_type: 'severe_driving', incident_count: 4 },
        { incident_type: 'theft_after_hours_movement', incident_count: 1 }],
    );
    await runWeeklyDigestPhase(MONDAY_0830);
    const message = String(whatsapp.sendWhatsAppGroup.mock.calls[0][1]);

    expect(message).toContain('2026-08-17 to 2026-08-23');
    expect(message).toContain('932.4 km across 2 of 2 tracked vehicles reporting');
    expect(message).toContain('Severe driving: 4');
    expect(message).toContain('Theft — after-hours movement: 1');
    expect(message).toContain('Prolonged unauthorized stop: 0');
    expect(message).toContain('Lost contact while moving: 0');
    expect(message).toContain('• LN40MGGP: 812.4 km, 21.5 h ignition');
    expect(message).toContain('• LN40MGGP: 14 over 5 measured days');
    expect(message).toContain('/fleet/daily-stats');
  });

  it('names no person — registrations are the only identity in it', () => {
    const message = buildWeeklyDigestMessage({
      weekStart: '2026-08-17', weekEnd: '2026-08-23', vehicles: [totals()],
      incidentCounts: new Map<IncidentType, number>(),
    });
    expect(message).not.toMatch(/driver|staff|employee/i);
  });

  it('ranks only the top three vehicles by distance', () => {
    const vehicles = [900, 800, 700, 600].map((distanceKm, index) => totals({
      vehicleId: `v${index}`, registration: `REG${index}`, distanceKm, harshDays: 0, harshEvents: 0,
    }));
    const message = buildWeeklyDigestMessage({
      weekStart: '2026-08-17', weekEnd: '2026-08-23', vehicles, incidentCounts: new Map(),
    });

    expect(message).toContain('REG0');
    expect(message).toContain('REG2');
    expect(message).not.toContain('REG3');
  });
});

// The rule migration 528's coverage flags exist to protect: "we could not see" and "nothing
// happened" are different claims, and rendering the first as 0 destroys the difference.
describe('honesty — an unmeasurable quantity is omitted and named, never rendered as 0', () => {
  const noIgnitionCoverage = totals({
    registration: 'CO40VRGP', distanceKm: 412.5, ignitionDays: 0, ignitionSeconds: 0,
    harshDays: 0, harshEvents: 0,
  });

  function messageFor(vehicles: WeeklyVehicleTotals[]): string {
    return buildWeeklyDigestMessage({
      weekStart: '2026-08-17', weekEnd: '2026-08-23', vehicles, incidentCounts: new Map(),
    });
  }

  it('shows distance only for a vehicle whose coverage_ignition was false all week', () => {
    const line = messageFor([noIgnitionCoverage]).split('\n').find((row) => row.includes('CO40VRGP: 412.5 km'));

    expect(line).toBeDefined();
    expect(line).toContain('ignition time not measurable this week');
    // The mutation this pins: rendering the unmeasurable hours as `0.0 h`. Asserted as an
    // explicit ABSENCE of a zero quantity, not merely as "the honest phrase is present" — a
    // line carrying both would otherwise pass.
    expect(line).not.toContain('0.0 h');
    expect(line).not.toMatch(/\d+\.\d+ h/);
  });

  it('still shows measured ignition hours for a vehicle that could measure them', () => {
    const line = messageFor([totals()]).split('\n').find((row) => row.includes('LN40MGGP'));
    expect(line).toContain('21.5 h ignition');
    expect(line).not.toContain('not measurable');
  });

  it('excludes a vehicle with no harsh-measurable day from the harsh list entirely', () => {
    const message = messageFor([
      totals({ registration: 'LN40MGGP', harshDays: 4, harshEvents: 2 }),
      noIgnitionCoverage,
    ]);
    const harshSection = message.split('Top harsh events:')[1]?.split('\n\n')[0] ?? '';

    expect(harshSection).toContain('LN40MGGP: 2 over 4 measured days');
    // An unobserved vehicle is not "the safest this week". It must not appear at any position,
    // and specifically not as a zero.
    expect(harshSection).not.toContain('CO40VRGP');
    expect(harshSection).not.toContain(': 0');
  });

  it('says the harsh count is not measurable when no vehicle-day could detect one', () => {
    const harshSection = messageFor([noIgnitionCoverage]).split('Top harsh events:')[1]?.split('\n\n')[0] ?? '';

    expect(harshSection).toContain('not measurable this week');
    expect(harshSection).not.toMatch(/:\s*0\b/);
  });

  // The converse guard: a real measured zero IS reportable, and must not be dressed up as an
  // absence of coverage. Otherwise the honest branch would be free to swallow everything.
  it('reports a genuine measured zero as such, distinguishing it from missing coverage', () => {
    const harshSection = messageFor([totals({ harshDays: 6, harshEvents: 0 })])
      .split('Top harsh events:')[1]?.split('\n\n')[0] ?? '';

    expect(harshSection).toContain('none recorded across 1 vehicles with usable coverage');
    expect(harshSection).not.toContain('not measurable');
  });
});

describe('the tracker-silence list', () => {
  it('names every vehicle with zero reporting days, by registration', () => {
    const message = buildWeeklyDigestMessage({
      weekStart: '2026-08-17', weekEnd: '2026-08-23', incidentCounts: new Map(),
      vehicles: [
        totals(),
        totals({ vehicleId: 'b', registration: 'SILENT1', reportingDays: 0, distanceKm: 0, ignitionDays: 0, harshDays: 0, harshEvents: 0 }),
        totals({ vehicleId: 'c', registration: 'SILENT2', reportingDays: 0, distanceKm: 0, ignitionDays: 0, harshDays: 0, harshEvents: 0 }),
      ],
    });
    const silentSection = message.split('No data all week (tracker silence):')[1] ?? '';

    expect(silentSection).toContain('• SILENT1');
    expect(silentSection).toContain('• SILENT2');
    expect(silentSection).not.toContain('LN40MGGP');
    expect(message).toContain('1 of 3 tracked vehicles reporting');
  });

  it('says so explicitly when every tracked vehicle reported', () => {
    const message = buildWeeklyDigestMessage({
      weekStart: '2026-08-17', weekEnd: '2026-08-23', vehicles: [totals()], incidentCounts: new Map(),
    });
    expect(message).toContain('every tracked vehicle reported at least one day');
  });

  it('carries a silent vehicle all the way from the LEFT JOIN into the message', async () => {
    mockQueries([vehicleRow({
      vehicle_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', registration: 'SILENT1',
      reporting_days: 0, distance_km: '0', ignition_days: 0, ignition_seconds: '0',
      harsh_days: 0, harsh_events: 0,
    })]);
    await runWeeklyDigestPhase(MONDAY_0830);

    expect(String(whatsapp.sendWhatsAppGroup.mock.calls[0][1])).toContain('• SILENT1');
  });
});
