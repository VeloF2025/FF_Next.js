import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const permissionCalls = vi.hoisted(() => [] as Array<[string, string]>);
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: unknown) => handler,
  withPermission: (key: string, action: string) => {
    permissionCalls.push([key, action]);
    return (handler: unknown) => handler;
  },
}));

const vehicleRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const deactivationRows = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const sqlCalls = vi.hoisted(() => [] as string[]);
const sqlValues = vi.hoisted(() => [] as unknown[][]);
const locationState = vi.hoisted(() => ({
  isActive: true,
  isGlobal: true,
  vehicleId: null as string | null,
}));
const sql = vi.hoisted(() => vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join(' ? ');
  sqlCalls.push(query);
  sqlValues.push(values);

  if (query.includes('SELECT id FROM fleet_vehicles')) return vehicleRows;
  if (query.includes('SET is_active = false')) return deactivationRows;

  if (query.includes('UPDATE fleet_authorized_locations')) {
    const relationshipUpdated = values[5] === true;
    const isGlobal = values[6];
    const clearVehicle = values[7] === true;
    const hasVehicleId = values[8] === true;
    const vehicleId = values[9];
    const isActive = values[10];

    if (relationshipUpdated) locationState.isGlobal = isGlobal === true;
    if (clearVehicle) locationState.vehicleId = null;
    else if (hasVehicleId) locationState.vehicleId = vehicleId as string;
    if (isActive !== null) locationState.isActive = isActive === true;

    return [{ id: 'location-1', ...locationState }];
  }

  return [{ id: 'location-1', ...locationState }];
}));
vi.mock('@/lib/neon-sql', () => ({ getSql: () => sql }));

import handler from '../locations';

function mockResponse() {
  const response = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };

  return response as unknown as NextApiResponse & typeof response;
}

async function callRoute(request: Partial<NextApiRequest>) {
  const response = mockResponse();
  await (handler as unknown as (req: NextApiRequest, res: NextApiResponse) => unknown)(
    {
      method: 'GET',
      query: {},
      body: {},
      headers: {},
      user: { id: 'user-1', role: 'manager' },
      ...request,
    } as unknown as NextApiRequest,
    response
  );
  return response;
}

beforeEach(() => {
  permissionCalls.splice(0);
  vehicleRows.splice(0);
  deactivationRows.splice(0, deactivationRows.length, { id: 'location-1' });
  sqlCalls.splice(0);
  sqlValues.splice(0);
  locationState.isActive = true;
  locationState.isGlobal = true;
  locationState.vehicleId = null;
  sql.mockClear();
});

describe('/api/fleet/locations', () => {
  it.each([
    ['GET', 'view'],
    ['POST', 'create'],
    ['PUT', 'edit'],
    ['DELETE', 'delete'],
  ])('%s uses fleet.locations:%s', async (method, action) => {
    await callRoute({ method, query: method === 'GET' ? {} : { id: 'location-1' } });

    expect(permissionCalls).toContainEqual(['fleet.locations', action]);
  });

  it('accepts office as a valid location type', async () => {
    const response = await callRoute({
      method: 'POST',
      body: {
        name: 'Head Office',
        lat: -26.1,
        lon: 28.1,
        radiusKm: 0.3,
        locationType: 'office',
        isGlobal: true,
      },
    });

    expect(response.statusCode).toBe(201);
  });

  it('rejects NaN coordinates before querying', async () => {
    const response = await callRoute({
      method: 'POST',
      body: {
        name: 'Bad',
        lat: 'not-a-number',
        lon: 28.1,
        radiusKm: 1,
        locationType: 'work_site',
        isGlobal: true,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(sqlCalls).toEqual([]);
  });

  it('rejects a vehicle-specific location when the vehicle does not exist', async () => {
    const response = await callRoute({
      method: 'POST',
      body: {
        name: 'Vehicle yard',
        lat: -26.1,
        lon: 28.1,
        radiusKm: 1,
        locationType: 'depot',
        vehicleId: 'missing-vehicle',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(sqlCalls).toHaveLength(1);
  });

  it('deactivates an already inactive location successfully', async () => {
    const response = await callRoute({ method: 'DELETE', query: { id: 'location-1' } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { id: 'location-1' } });
    expect(sqlCalls[0]).not.toContain('is_active = true');
  });

  it('reactivates a location through PUT', async () => {
    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { isActive: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { id: 'location-1', isActive: true } });
  });

  it('rejects reassignment to a missing vehicle before updating the location', async () => {
    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { vehicleId: 'missing-vehicle' },
    });

    expect(response.statusCode).toBe(422);
    expect(sqlCalls).toHaveLength(1);
    expect(sqlCalls[0]).toContain('SELECT id FROM fleet_vehicles');
  });

  it('reassigns a location as vehicle-specific after verifying the target vehicle', async () => {
    vehicleRows.push({ id: 'vehicle-2' });

    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { vehicleId: 'vehicle-2' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      data: { id: 'location-1', isGlobal: false, vehicleId: 'vehicle-2' },
    });
    expect(sqlValues[1]).toContain(false);
    expect(sqlValues[1]).toContain('vehicle-2');
  });

  // A non-boolean isActive used to coerce through `=== true` to false, so
  // asking to activate with a stringly-typed body silently DEACTIVATED the
  // location and still returned 200.
  it.each([
    ['string', 'true'],
    ['number', 1],
    ['object', {}],
  ])('rejects a %s isActive instead of coercing it to a deactivation', async (_label, value) => {
    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { isActive: value },
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({
      error: { details: { isActive: 'isActive must be a boolean' } },
    });
    // Positive pin on WHY nothing changed: no UPDATE was issued at all, and the
    // row is still active rather than having been flipped off.
    expect(sqlCalls.filter((query) => query.includes('UPDATE fleet_authorized_locations'))).toHaveLength(0);
    expect(locationState.isActive).toBe(true);
  });

  it.each([
    [true, true],
    [false, false],
  ])('applies a boolean isActive of %s', async (value, expected) => {
    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { isActive: value },
    });

    expect(response.statusCode).toBe(200);
    expect(locationState.isActive).toBe(expected);
  });

  it('leaves is_active untouched when isActive is omitted', async () => {
    locationState.isActive = false;

    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { name: 'Renamed depot' },
    });

    expect(response.statusCode).toBe(200);
    expect(locationState.isActive).toBe(false);
  });

  it('rejects an unknown locationType rather than coercing it to a default', async () => {
    const response = await callRoute({
      method: 'PUT',
      query: { id: 'location-1' },
      body: { locationType: 'not_a_real_type' },
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({
      error: { details: { locationType: 'Select a valid location type' } },
    });
    expect(sqlCalls.filter((query) => query.includes('UPDATE fleet_authorized_locations'))).toHaveLength(0);
  });
});
