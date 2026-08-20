/**
 * Pins that the live-positions route is auth-wrapped.
 *
 * Deliberately does NOT mock @/lib/auth: this exercises the real withAuth, so
 * deleting the wrapper from live.ts turns this file red. live.test.ts stubs the
 * wrapper out to test handler behaviour, which is why the guarantee needs its
 * own home here.
 *
 * The feed carries live GPS and driver names for the whole fleet, so an
 * unauthenticated caller must never reach the query.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
}));

import handler from '@/pages/api/fleet/positions/live';

describe('GET /api/fleet/positions/live — authentication', () => {
  it('rejects an unauthenticated request with 401 and never runs the query', async () => {
    sqlMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    // The position feed must not be touched before the caller is identified.
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it('rejects a request bearing a garbage token', async () => {
    sqlMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
