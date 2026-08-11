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
const sql = vi.hoisted(() => vi.fn((strings: TemplateStringsArray) => {
  const query = strings.join(' ? ');
  sqlCalls.push(query);

  if (query.includes('SELECT id FROM fleet_vehicles')) return vehicleRows;
  if (query.includes('SET is_active = false')) return deactivationRows;

  return [{ id: 'location-1', isActive: true }];
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
});
