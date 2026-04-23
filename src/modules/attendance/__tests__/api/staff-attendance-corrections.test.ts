/**
 * Handler tests for GET /api/staff/attendance-corrections — supervisor
 * review queue. Thin handler but the status filter validation is
 * load-bearing (a silent accept on a bogus value would leak data outside
 * the intended bucket).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

import handler from '../../../../../pages/api/staff/attendance-corrections';

function makeReq(query: Record<string, string> = {}, method: string = 'GET'): NextApiRequest {
  return { method, query, headers: {}, socket: {} } as unknown as NextApiRequest;
}

function makeRes() {
  const captured: { statusCode: number; body?: unknown; headers: Record<string, string> } = {
    statusCode: 200,
    headers: {},
  };
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

describe('GET /api/staff/attendance-corrections', () => {
  it('405 on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({}, 'POST'), res);
    expect(captured.statusCode).toBe(405);
  });

  it('400 on unknown status value', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ status: 'frozen' }), res);
    expect(captured.statusCode).toBe(400);
  });

  it('defaults to status=pending (parameterises to sql)', async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res, captured } = makeRes();
    await handler(makeReq({}), res);
    expect(captured.statusCode).toBe(200);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    expect(call.slice(1)).toContain('pending');
    const body = captured.body as { data: { statusFilter: string } };
    expect(body.data.statusFilter).toBe('pending');
  });

  it("status='all' uses the union-of-all query (no WHERE a.status = $1)", async () => {
    mocks.sql.mockResolvedValueOnce([]);
    const { res } = makeRes();
    await handler(makeReq({ status: 'all' }), res);
    const call = mocks.sql.mock.calls[0] as [readonly string[], ...unknown[]];
    const sqlText = call[0].join(' ');
    expect(sqlText).not.toMatch(/WHERE\s+a\.status\s*=\s*\$/i);
  });
});
