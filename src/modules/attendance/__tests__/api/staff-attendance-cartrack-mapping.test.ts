/**
 * Handler tests for /api/staff/attendance-cartrack-mapping.
 *
 * Covers: list (with + without candidates), candidate-fetch failure
 * fallback, per-action permission gate (edit for POST), update validation,
 * not-found on missing fleet vehicle.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  userHasPermission: vi.fn(async () => true),
  cartrackClientFromEnv: vi.fn(() => ({
    listVehicles: vi.fn(async () => [
      { cartrackId: 'ct-1', registration: 'CA12345', description: 'Bakkie' },
    ]),
    fetchPositionAt: vi.fn(),
  })),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/permissions', () => ({
  userHasPermission: mocks.userHasPermission,
}));
vi.mock('@/services/tracking/cartrack/client', () => ({
  cartrackClientFromEnv: mocks.cartrackClientFromEnv,
  CartrackError: class extends Error {},
}));

import handler from '../../../../../pages/api/staff/attendance-cartrack-mapping';

function makeReq(
  opts: {
    method?: string;
    query?: Record<string, string>;
    body?: Record<string, unknown>;
    userId?: string | null;
  } = {}
): NextApiRequest {
  const r: Partial<NextApiRequest> & { user?: { id: string } } = {
    method: opts.method ?? 'GET',
    query: opts.query ?? {},
    headers: {},
    body: opts.body ?? {},
  };
  const userId = opts.userId === undefined ? 'admin-1' : opts.userId;
  if (userId) r.user = { id: userId };
  return r as NextApiRequest;
}

function makeRes() {
  const captured: {
    statusCode: number;
    body?: unknown;
    headers: Record<string, string>;
  } = { statusCode: 200, headers: {} };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    send(d: unknown) { captured.body = d; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; },
    getHeader() { return undefined; },
  };
  return { res: res as unknown as NextApiResponse, captured };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/staff/attendance-cartrack-mapping', () => {
  it('returns fleet vehicles with candidates=[] when include_candidates omitted', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: 'Bakkie', cartrack_vehicle_id: null },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({}), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      data: { vehicles: unknown[]; candidates: unknown[]; candidatesError: string | null };
    };
    expect(body.data.vehicles).toHaveLength(1);
    expect(body.data.candidates).toEqual([]);
    expect(body.data.candidatesError).toBe(null);
    // Cartrack client must NOT have been constructed for the no-candidates path.
    expect(mocks.cartrackClientFromEnv).not.toHaveBeenCalled();
  });

  it('include_candidates=true: fetches Cartrack vehicle list', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: null, cartrack_vehicle_id: null },
    ]);
    const { res, captured } = makeRes();
    await handler(makeReq({ query: { include_candidates: 'true' } }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as {
      data: { candidates: Array<{ cartrackId: string }>; candidatesError: string | null };
    };
    expect(body.data.candidates).toHaveLength(1);
    expect(body.data.candidates[0]!.cartrackId).toBe('ct-1');
    expect(body.data.candidatesError).toBe(null);
  });

  it('include_candidates=true: Cartrack failure surfaces as candidatesError, 200 still returned', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    mocks.cartrackClientFromEnv.mockImplementationOnce(() => {
      throw new Error('CARTRACK_BASE_URL not set');
    });
    const { res, captured } = makeRes();
    await handler(makeReq({ query: { include_candidates: 'true' } }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { data: { candidatesError: string | null } };
    expect(body.data.candidatesError).toMatch(/CARTRACK_BASE_URL/);
  });
});

describe('POST /api/staff/attendance-cartrack-mapping', () => {
  it('400 when fleet_vehicle_id missing', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { cartrack_vehicle_id: 'ct-1' } }),
      res
    );
    expect(captured.statusCode).toBe(400);
  });

  it('401 when no authed user on request', async () => {
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: 'ct-1' }, userId: null }),
      res
    );
    expect(captured.statusCode).toBe(401);
  });

  it('403 when user lacks edit permission (view-only role)', async () => {
    mocks.userHasPermission.mockResolvedValueOnce(false);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: 'ct-1' } }),
      res
    );
    expect(captured.statusCode).toBe(403);
    // Must NOT have reached the UPDATE.
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('404 when fleet vehicle does not exist', async () => {
    mocks.sql.mockResolvedValueOnce([]); // UPDATE RETURNING produces no rows
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'ghost', cartrack_vehicle_id: 'ct-1' } }),
      res
    );
    expect(captured.statusCode).toBe(404);
  });

  it('happy path — sets cartrack_vehicle_id and returns updated row', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: null, cartrack_vehicle_id: 'ct-1' },
    ]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: 'ct-1' } }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    expect(call.slice(1)).toContain('ct-1');
    expect(call.slice(1)).toContain('fv-1');
  });

  it('can clear the mapping with cartrack_vehicle_id=null', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: null, cartrack_vehicle_id: null },
    ]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: null } }),
      res
    );
    expect(captured.statusCode).toBe(200);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    expect(call.slice(1)).toContain(null);
  });

  it.each<[string, unknown]>([
    ['whitespace', '   '],
    ['empty string', ''],
    ['explicit null', null],
    ['missing key', undefined],
  ])('POST normalises cartrack_vehicle_id=%s to null', async (_label, input) => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: null, cartrack_vehicle_id: null },
    ]);
    const { res, captured } = makeRes();
    const body: Record<string, unknown> = { fleet_vehicle_id: 'fv-1' };
    if (input !== undefined) body.cartrack_vehicle_id = input;
    await handler(makeReq({ method: 'POST', body }), res);
    expect(captured.statusCode).toBe(200);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    expect(call.slice(1)).toContain(null);
  });

  it('rejects a cartrack_vehicle_id that is not in the Cartrack fleet (400)', async () => {
    // listVehicles returns only 'ct-1'; caller submits 'ct-typo'.
    const { res, captured } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: 'ct-typo' } }),
      res
    );
    expect(captured.statusCode).toBe(400);
    const body = captured.body as { error: { message: string } };
    expect(body.error.message).toMatch(/not found in Cartrack fleet|allow_unknown/i);
    // Crucially: the UPDATE must NOT have been reached.
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('?allow_unknown=true persists an unrecognised cartrack_vehicle_id (escape hatch for Cartrack offline)', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: null, cartrack_vehicle_id: 'ct-typo' },
    ]);
    const { res, captured } = makeRes();
    await handler(
      makeReq({
        method: 'POST',
        body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: 'ct-typo' },
        query: { allow_unknown: 'true' },
      }),
      res
    );
    expect(captured.statusCode).toBe(200);
  });

  it('POST UPDATE filters to status IN (active, maintenance) — defence-in-depth against retired rows', async () => {
    mocks.sql.mockResolvedValueOnce([
      { id: 'fv-1', registration: 'CA12345', description: null, cartrack_vehicle_id: 'ct-1' },
    ]);
    const { res } = makeRes();
    await handler(
      makeReq({ method: 'POST', body: { fleet_vehicle_id: 'fv-1', cartrack_vehicle_id: 'ct-1' } }),
      res
    );
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    const sqlText = call[0].join(' ');
    expect(sqlText).toMatch(/status\s+IN\s*\(\s*'active'\s*,\s*'maintenance'\s*\)/i);
  });
});
