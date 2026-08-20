/**
 * Pins that the readiness route is really auth-wrapped.
 *
 * Deliberately does NOT mock @/lib/auth: this exercises the real withAuth, so
 * deleting the wrapper from readiness.ts turns this file red. readiness.test.ts
 * stubs the wrappers out to test handler behaviour, which is why the guarantee
 * needs its own home here.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({
  query: (...a: unknown[]) => queryMock(...a),
}));

import handler from '@/pages/api/communications/whatsapp/readiness';

describe('GET /api/communications/whatsapp/readiness — authentication', () => {
  it('rejects an unauthenticated request with 401 and never reads config', async () => {
    queryMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'GET' });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects a request bearing a garbage token', async () => {
    queryMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'GET',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
