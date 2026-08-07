/**
 * `compliance.ts` shipped with no test file. Its date handling is not trivial —
 * SAST-relative "today", an ISO-shape check, a day-window default and a
 * from > to guard — and a wrong window silently reports the wrong day's
 * compliance, which reads exactly like "no violations".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const withPermissionArgs = vi.hoisted(() => [] as Array<[string, string]>);
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: (key: string, action: string) => {
    withPermissionArgs.push([key, action]);
    return (h: unknown) => h;
  },
}));

const loadCompliance = vi.fn();
vi.mock('@/modules/fleet/parking/complianceQueries', () => ({
  loadCompliance: (...a: unknown[]) => loadCompliance(...a),
}));

import handler from '../compliance';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return res as unknown as NextApiResponse & typeof res;
}

function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(
    (handler as unknown as (q: NextApiRequest, s: NextApiResponse) => unknown)(
      { method: 'GET', query: {}, user: { id: 'u1', role: 'manager' }, ...req } as unknown as NextApiRequest,
      res
    )
  ).then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
  loadCompliance.mockResolvedValue([]);
});

describe('authorization', () => {
  it('is gated on fleet.parking view, not merely authenticated', () => {
    // Mutation-kill: drop the wrapper or weaken the key and this fails.
    expect(withPermissionArgs.length).toBeGreaterThan(0);
    const [, action] = withPermissionArgs[0]!;
    expect(action).toBe('view');
  });
});

describe('date window validation', () => {
  it('rejects a malformed from date rather than silently defaulting', async () => {
    // A silently-defaulted window reports a different day's compliance, which
    // is indistinguishable from a clean day.
    const res = await call({ query: { from: 'not-a-date' } });
    expect(res.statusCode).toBe(400);
    expect(loadCompliance).not.toHaveBeenCalled();
  });

  it('rejects a from date later than the to date', async () => {
    const res = await call({ query: { from: '2026-08-07', to: '2026-08-01' } });
    expect(res.statusCode).toBe(400);
    expect(loadCompliance).not.toHaveBeenCalled();
  });

  it('accepts a well-formed window and passes it through', async () => {
    const res = await call({ query: { from: '2026-08-01', to: '2026-08-07' } });
    expect(res.statusCode).toBe(200);
    expect(loadCompliance).toHaveBeenCalledTimes(1);
  });

  it('defaults the window when neither bound is supplied', async () => {
    const res = await call({ query: {} });
    expect(res.statusCode).toBe(200);
    expect(loadCompliance).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-GET method', async () => {
    const res = await call({ method: 'POST' });
    expect(res.statusCode).toBe(405);
  });
});
