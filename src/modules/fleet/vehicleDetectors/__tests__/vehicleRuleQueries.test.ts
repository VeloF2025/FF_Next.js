import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(), queryOne: vi.fn(), transaction: vi.fn(),
  txnQuery: vi.fn(), txnQueryOne: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({ query: db.query, queryOne: db.queryOne, transaction: db.transaction }));

import {
  VehicleRuleValidationError,
  createVehicleRuleVersion,
  listVehicleRuleVersions,
  loadEffectiveVehicleRule,
} from '../vehicleRuleQueries';
import type { CreateVehicleRuleVersionInput } from '../types';

const USER = '11111111-1111-4111-8111-111111111111';

const row = {
  id: '22222222-2222-4222-8222-222222222222', version: 1, timezone: 'Africa/Johannesburg',
  effective_from: '2026-08-25T08:00:00.000Z', effective_to: null,
  after_hours_start_time: '18:00:00', after_hours_end_time: '06:00:00',
  weekends_are_after_hours: true, public_holidays_are_after_hours: true,
  theft_displacement_meters: 500, theft_min_positions: 2,
  // NUMERIC columns arrive as strings from node-postgres. Modelled as strings
  // here deliberately: a fixture of JS numbers would let a missing Number()
  // pass, and the detector would then compare a string to a threshold.
  harsh_linear_g: '0.350', harsh_lateral_g: '0.350',
  harsh_min_speed_kph: '20.00', speed_over_limit_kph: '15.00',
  unauthorized_stop_minutes: 45, lost_contact_minutes: 30, idle_alert_minutes: 20,
  known_site_radius_meters: 500, change_reason: null, created_by: USER,
  created_at: '2026-08-25T08:00:00.000Z',
};

const input: CreateVehicleRuleVersionInput = {
  timezone: 'Africa/Johannesburg', effectiveFrom: '2099-01-01T00:00:00.000Z',
  afterHoursStartTime: '19:00', afterHoursEndTime: '05:00',
  weekendsAreAfterHours: true, publicHolidaysAreAfterHours: false,
  theftDisplacementMeters: 750, theftMinPositions: 3,
  harshLinearG: 0.4, harshLateralG: 0.45, harshMinSpeedKph: 25, speedOverLimitKph: 10,
  unauthorizedStopMinutes: 60, lostContactMinutes: 45, idleAlertMinutes: 15,
  knownSiteRadiusMeters: 400, changeReason: '  Tighter after-hours window  ',
};

beforeEach(() => {
  vi.clearAllMocks();
  db.transaction.mockImplementation(async (work: (txn: unknown) => Promise<unknown>) =>
    work({ query: db.txnQuery, queryOne: db.txnQueryOne }));
});

describe('reading the effective vehicle rule', () => {
  it('selects only the version whose half-open interval covers the as-of instant', async () => {
    db.queryOne.mockResolvedValue(row);
    await expect(loadEffectiveVehicleRule('2026-08-25T10:00:00.000Z')).resolves.toMatchObject({ version: 1 });
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('effective_from <= $1::timestamptz');
    expect(db.queryOne.mock.calls[0]?.[0]).toContain('effective_to > $1::timestamptz');
  });

  it('converts every NUMERIC threshold to a number', async () => {
    db.queryOne.mockResolvedValue(row);
    const rule = await loadEffectiveVehicleRule('2026-08-25T10:00:00.000Z');
    expect(rule?.harshLinearG).toBe(0.35);
    expect(rule?.harshLateralG).toBe(0.35);
    expect(rule?.harshMinSpeedKph).toBe(20);
    expect(rule?.speedOverLimitKph).toBe(15);
  });

  it('returns null rather than a fabricated default when no version is open', async () => {
    db.queryOne.mockResolvedValue(null);
    await expect(loadEffectiveVehicleRule('2026-08-25T10:00:00.000Z')).resolves.toBeNull();
  });

  it('lists history newest version first', async () => {
    db.query.mockResolvedValue([{ ...row, version: 2 }, row]);
    await expect(listVehicleRuleVersions()).resolves.toMatchObject([{ version: 2 }, { version: 1 }]);
    expect(db.query.mock.calls[0]?.[0]).toContain('ORDER BY version DESC');
  });
});

describe('creating a version', () => {
  it('locks the open version, closes it, then inserts the next — all in one transaction', async () => {
    db.txnQueryOne.mockResolvedValueOnce(row).mockResolvedValueOnce({
      ...row, id: '33333333-3333-4333-8333-333333333333', version: 2,
      effective_from: input.effectiveFrom, change_reason: 'Tighter after-hours window',
    });
    db.txnQuery.mockResolvedValue([]);

    await expect(createVehicleRuleVersion(input, USER)).resolves.toMatchObject({
      version: 2, changeReason: 'Tighter after-hours window',
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // The lock is what makes a concurrent caller queue instead of interleave.
    expect(db.txnQueryOne.mock.calls[0]?.[0]).toContain('FOR UPDATE');
    expect(db.txnQuery.mock.calls[0]?.[0]).toContain('SET effective_to = $1::timestamptz');
    // Close BEFORE insert, or the gist exclusion rejects the insert.
    expect(db.txnQuery.mock.invocationCallOrder[0]).toBeLessThan(db.txnQueryOne.mock.invocationCallOrder[1]!);
    expect(db.txnQueryOne.mock.calls[1]?.[1]).toContain(2);
    // No query is issued outside the transaction.
    expect(db.query).not.toHaveBeenCalled();
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it('carries every editable threshold into the insert', async () => {
    db.txnQueryOne.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, version: 2 });
    db.txnQuery.mockResolvedValue([]);
    await createVehicleRuleVersion(input, USER);
    const values = db.txnQueryOne.mock.calls[1]?.[1] as unknown[];
    expect(values).toEqual([
      2, 'Africa/Johannesburg', '2099-01-01T00:00:00.000Z', '19:00', '05:00',
      true, false, 750, 3, 0.4, 0.45, 25, 10, 60, 45, 15, 400,
      'Tighter after-hours window', USER,
    ]);
  });

  it.each([
    [1, 2],
    [2, 3],
    [7, 8],
  ])('derives the next version from the open row: v%i becomes v%i', async (open, next) => {
    // A constant 2 here passes every test that only ever starts from version 1,
    // and then collides forever on the third version an operator creates.
    db.txnQueryOne
      .mockResolvedValueOnce({ ...row, version: open })
      .mockResolvedValueOnce({ ...row, version: next, effective_from: input.effectiveFrom });
    db.txnQuery.mockResolvedValue([]);

    await expect(createVehicleRuleVersion(input, USER)).resolves.toMatchObject({ version: next });
    expect((db.txnQueryOne.mock.calls[1]?.[1] as unknown[])[0]).toBe(next);
  });

  it('refuses a backdated activation before opening a transaction', async () => {
    await expect(createVehicleRuleVersion({ ...input, effectiveFrom: '2020-01-01T00:00:00.000Z' }, USER))
      .rejects.toBeInstanceOf(VehicleRuleValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses an activation at or before the current version activation', async () => {
    db.txnQueryOne.mockResolvedValueOnce({ ...row, effective_from: '2099-06-01T00:00:00.000Z' });
    await expect(createVehicleRuleVersion({ ...input, effectiveFrom: '2099-01-01T00:00:00.000Z' }, USER))
      .rejects.toBeInstanceOf(VehicleRuleValidationError);
    expect(db.txnQuery).not.toHaveBeenCalled();
  });

  it('refuses to invent a first version, and names the likely cause', async () => {
    db.txnQueryOne.mockResolvedValueOnce(null);
    // 529 seeds an open version and every path leaves exactly one, so "none"
    // almost always means a concurrent caller won the race.
    await expect(createVehicleRuleVersion(input, USER)).rejects.toThrow(/created concurrently; reload/);
    expect(db.txnQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['a single-position theft threshold', { theftMinPositions: 1 }],
    ['a fractional theft threshold', { theftMinPositions: 2.5 }],
    ['a zero displacement', { theftDisplacementMeters: 0 }],
    ['a zero stop window', { unauthorizedStopMinutes: 0 }],
    ['a zero lost-contact window', { lostContactMinutes: 0 }],
    ['a zero idle window', { idleAlertMinutes: 0 }],
    ['a zero known-site radius', { knownSiteRadiusMeters: 0 }],
    ['a negative g threshold', { harshLinearG: -0.1 }],
    ['a negative speed gate', { harshMinSpeedKph: -1 }],
    ['a fractional minute window', { unauthorizedStopMinutes: 45.5 }],
    ['a blank timezone', { timezone: '  ' }],
    ['a malformed start time', { afterHoursStartTime: '18h00' }],
    ['an out-of-range end time', { afterHoursEndTime: '25:00' }],
  ])('refuses %s before touching the database', async (_label, override) => {
    await expect(createVehicleRuleVersion({ ...input, ...override }, USER))
      .rejects.toBeInstanceOf(VehicleRuleValidationError);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('does not turn a constraint violation into a success', async () => {
    db.txnQueryOne.mockResolvedValueOnce(row);
    db.txnQuery.mockResolvedValue([]);
    // What a lost concurrent race actually looks like: the second caller's
    // insert is rejected by the one-open partial unique index.
    db.txnQueryOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint "ux_fleet_vehicle_operational_rules_one_open"'), { code: '23505' }));
    await expect(createVehicleRuleVersion(input, USER)).rejects.toThrow(/ux_fleet_vehicle_operational_rules_one_open/);
  });
});
