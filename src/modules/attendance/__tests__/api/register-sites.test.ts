import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import handler from '../../../../../pages/api/my/register-sites';

function makeReq(method = 'GET'): NextApiRequest {
  return { method, query: {}, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as NextApiRequest;
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
beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/my/register-sites', () => {
  it('405s on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq('POST'), res);
    expect(captured.statusCode).toBe(405);
  });
  it('returns id+name sites', async () => {
    mocks.sql.mockResolvedValue([{ id: 'p1', name: 'Lawley' }, { id: 'p2', name: 'Mohadin' }]);
    const { res, captured } = makeRes();
    await handler(makeReq('GET'), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: { sites: { id: string; name: string }[] } };
    expect(body.data.sites).toHaveLength(2);
    expect(body.data.sites[0]).toEqual({ id: 'p1', name: 'Lawley' });
  });
});
