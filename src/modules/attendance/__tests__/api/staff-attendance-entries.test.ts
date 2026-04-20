/**
 * Handler tests for GET /api/staff/attendance-entries.
 * The withAuth/withPermission middleware is mocked to a passthrough so we
 * exercise the handler's own branches (input validation, SQL shape,
 * response mapping) directly.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../../../../../pages/api/staff/attendance-entries';

function makeReq(query: Record<string, string> = {}, method: string = 'GET'): NextApiRequest {
  return { method, query, headers: {}, socket: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = {
    status(c: number) { captured.statusCode = c; return this; },
    json(d: unknown) { captured.body = d; return this; },
    setHeader() {},
    getHeader() {},
  };
  return { res: res as unknown as NextApiResponse, captured };
}

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/staff/attendance-entries', () => {
  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'POST'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 when staffId is not a UUID', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ staffId: 'not-a-uuid' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('clamps days to the 1..90 range', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ staffId: VALID_UUID, days: '500' }), res);
    // First call is the entries SELECT — check the param made it in clamped.
    const firstCall = mocks.sql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(firstCall[1]).toBe(VALID_UUID);
    expect(firstCall[2]).toBe(90);
  });

  it('defaults days to 30 when missing', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res } = makeRes();
    await handler(makeReq({ staffId: VALID_UUID }), res);
    const firstCall = mocks.sql.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(firstCall[2]).toBe(30);
  });

  it('returns entries + exceptions, maps snake_case to camelCase, and strips selfie URLs to booleans (IDOR guard)', async () => {
    const entry = {
      id: 'e1', work_date: '2026-04-20',
      clock_in_at: '2026-04-20T06:00:00Z', clock_out_at: '2026-04-20T14:00:00Z',
      clock_in_lat: -26.2, clock_in_lon: 28.0,
      clock_out_lat: -26.2, clock_out_lon: 28.0,
      status: 'closed', site_geofence_id: 's1', vehicle_assignment_id: null,
      selfie_in_url: '/storage/attendance/u/2026-04-20/in.jpg',
      selfie_out_url: null,
      notes: null,
    };
    const exc = {
      id: 'x1', entry_id: 'e1',
      exception_kind: 'geofence_mismatch', severity: 'warning',
      detected_at: '2026-04-20T06:01:00Z', resolved_at: null, resolution_note: null,
    };
    mocks.sql.mockResolvedValueOnce([entry]).mockResolvedValueOnce([exc]);
    const { res, captured } = makeRes();
    await handler(makeReq({ staffId: VALID_UUID }), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: {
      entries: Array<Record<string, unknown>>;
      exceptions: Array<{ kind: string }>;
    } };
    expect(body.data.entries[0]!.entryId).toBe('e1');
    expect(body.data.exceptions[0]!.kind).toBe('geofence_mismatch');
    // Critical IDOR guard: URLs MUST NOT be returned. Only booleans.
    expect(body.data.entries[0]).not.toHaveProperty('selfieInUrl');
    expect(body.data.entries[0]).not.toHaveProperty('selfieOutUrl');
    expect(body.data.entries[0]!.hasSelfieIn).toBe(true);
    expect(body.data.entries[0]!.hasSelfieOut).toBe(false);
  });

  it('skips the exceptions query when there are no entries', async () => {
    mocks.sql.mockResolvedValue([]);
    const { res, captured } = makeRes();
    await handler(makeReq({ staffId: VALID_UUID }), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });

  it('500 when the DB rejects', async () => {
    mocks.sql.mockRejectedValue(new Error('pg down'));
    const { res, captured } = makeRes();
    await handler(makeReq({ staffId: VALID_UUID }), res);
    expect(captured.statusCode).toBe(500);
  });
});
