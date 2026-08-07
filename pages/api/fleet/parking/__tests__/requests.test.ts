/**
 * `requests.ts` shipped with no test file. It is short, but it is the list an
 * approver acts from and it is gated on a permission — an ungated or
 * wrongly-gated list leaks who has declared what.
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

const loadPendingRequests = vi.fn();
vi.mock('@/modules/fleet/parking/approvalQueries', () => ({
  loadPendingRequests: (...a: unknown[]) => loadPendingRequests(...a),
}));

import handler from '../requests';

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
  loadPendingRequests.mockResolvedValue([]);
});

describe('requests list', () => {
  it('is gated on fleet.parking-requests view', () => {
    // Mutation-kill: this is the only assertion that the queue is not public.
    expect(withPermissionArgs).toContainEqual(['fleet.parking-requests', 'view']);
  });

  it('returns the pending queue', async () => {
    loadPendingRequests.mockResolvedValue([{ id: 'r1' }]);
    const res = await call({});
    expect(res.statusCode).toBe(200);
    expect(loadPendingRequests).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-GET method — the list must not mutate', async () => {
    const res = await call({ method: 'POST' });
    expect(res.statusCode).toBe(405);
    expect(loadPendingRequests).not.toHaveBeenCalled();
  });
});
