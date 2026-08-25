import type { NextApiRequest, NextApiResponse } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(), list: vi.fn(), gates: [] as Array<[string, string]>,
}));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => (handler: unknown) => {
    mocks.gates.push([key, action]);
    return handler;
  },
}));
vi.mock('@/modules/fleet/vehicleDetectors/vehicleRuleQueries', async () => {
  const actual = await vi.importActual<typeof import('@/modules/fleet/vehicleDetectors/vehicleRuleQueries')>(
    '@/modules/fleet/vehicleDetectors/vehicleRuleQueries');
  return { ...actual, createVehicleRuleVersion: mocks.create, listVehicleRuleVersions: mocks.list };
});

import handler from '@/pages/api/fleet/vehicle-rules/index';
import { VehicleRuleValidationError } from '@/modules/fleet/vehicleDetectors/vehicleRuleQueries';
import { VEHICLE_RULE_TIMEZONE } from '@/modules/fleet/vehicleDetectors/types';

const USER = '11111111-1111-4111-8111-111111111111';
const body = {
  timezone: VEHICLE_RULE_TIMEZONE, effectiveFrom: '2099-01-01T00:00:00.000Z',
  afterHoursStartTime: '21:00', afterHoursEndTime: '05:00',
  weekendsAreAfterHours: true, publicHolidaysAreAfterHours: true,
  theftDisplacementMeters: 500, theftMinPositions: 2,
  harshLinearG: 0.35, harshLateralG: 0.35, harshMinSpeedKph: 20, speedOverLimitKph: 15,
  unauthorizedStopMinutes: 45, lostContactMinutes: 30, idleAlertMinutes: 20,
  knownSiteRadiusMeters: 500, changeReason: 'Approved calibration',
};

async function call(method: string, requestBody: unknown = body, user: unknown = { id: USER, role: 'admin' }) {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) { state.status = code; return res; },
    json(value: unknown) { state.body = value; return res; },
    setHeader(name: string, value: string) { state.headers[name] = value; return res; },
  } as unknown as NextApiResponse;
  await handler({ method, body: requestBody, query: {}, user } as unknown as NextApiRequest, res);
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.gates.length = 0;
  mocks.create.mockResolvedValue({ version: 2 });
  mocks.list.mockResolvedValue([]);
});

describe('vehicle rules API access', () => {
  it('gates every request on fleet.vehicle-rules, with a method-specific action', async () => {
    await call('GET');
    expect(mocks.gates).toEqual([['fleet.vehicle-rules', 'view']]);
    mocks.gates.length = 0;
    await call('POST');
    // 'create', not 'edit': a POST authors a new version and never mutates a row.
    expect(mocks.gates).toEqual([['fleet.vehicle-rules', 'create']]);
  });

  it('refuses an unauthenticated request rather than acting as nobody', async () => {
    const result = await call('POST', body, null);
    expect(result.status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('allows only GET and POST', async () => {
    const result = await call('PATCH');
    expect(result.status).toBe(405);
    expect(result.headers.Allow).toBe('GET, POST');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('attributes the version to the session, never to the body', async () => {
    const result = await call('POST', { ...body, actorUserId: 'attacker' });
    expect(result.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ changeReason: 'Approved calibration' }), USER);
  });
});

describe('vehicle rules API validation', () => {
  it.each([
    ['a missing change reason', { changeReason: '   ' }],
    ['a foreign timezone', { timezone: 'UTC' }],
    ['a malformed activation instant', { effectiveFrom: '2099-02-30T00:00:00.000Z' }],
    ['a date-only activation', { effectiveFrom: '2099-01-01' }],
    ['a malformed after-hours start', { afterHoursStartTime: '6pm' }],
    ['a malformed after-hours end', { afterHoursEndTime: '' }],
    ['a non-boolean weekend flag', { weekendsAreAfterHours: 'yes' }],
    ['a string threshold', { theftDisplacementMeters: '500' }],
    ['a NaN threshold', { harshLinearG: Number.NaN }],
    ['a missing threshold', { knownSiteRadiusMeters: undefined }],
  ])('rejects %s with 400 and never reaches the database', async (_label, override) => {
    const result = await call('POST', { ...body, ...override });
    expect(result.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('names the timezone it requires, and takes it from the shared constant', async () => {
    // A generic "all fields are required" tells the caller nothing, and a
    // second hard-coded literal would drift from what 529 seeds.
    const result = await call('POST', { ...body, timezone: 'UTC' });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain(`timezone must be ${VEHICLE_RULE_TIMEZONE}`);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    ['effectiveFrom', { effectiveFrom: 'nonsense' }, 'effectiveFrom must be a valid ISO instant'],
    ['changeReason', { changeReason: '  ' }, 'changeReason is required'],
    ['afterHoursStartTime', { afterHoursStartTime: '6pm' }, 'After-hours times must be HH:MM'],
    ['weekendsAreAfterHours', { weekendsAreAfterHours: 'yes' }, 'must be booleans'],
    ['knownSiteRadiusMeters', { knownSiteRadiusMeters: 'wide' }, 'knownSiteRadiusMeters'],
  ])('says which field it refused for %s', async (_label, override, expected) => {
    const result = await call('POST', { ...body, ...override });
    expect(result.status).toBe(400);
    expect(JSON.stringify(result.body)).toContain(expected);
  });

  it.each([[null], ['a string'], [[]], [42]])('rejects the non-object body %s', async (requestBody) => {
    expect((await call('POST', requestBody)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('surfaces a domain validation failure as 400, not 500', async () => {
    mocks.create.mockRejectedValue(new VehicleRuleValidationError('effectiveFrom cannot be more than one minute in the past'));
    const result = await call('POST');
    expect(result.status).toBe(400);
  });

  it('does not convert a transaction failure into a success', async () => {
    mocks.create.mockRejectedValue(new Error('insert failed'));
    const result = await call('POST');
    expect(result.status).toBe(500);
    expect(result.body).not.toMatchObject({ success: true });
  });

  it('does not convert a list failure into an empty list', async () => {
    mocks.list.mockRejectedValue(new Error('select failed'));
    const result = await call('GET');
    expect(result.status).toBe(500);
    expect(result.body).not.toMatchObject({ data: [] });
  });
});
