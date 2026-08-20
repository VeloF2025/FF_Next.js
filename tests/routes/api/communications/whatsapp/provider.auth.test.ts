/**
 * Pins that the provider flip is really auth-wrapped.
 *
 * Deliberately does NOT mock @/lib/auth. Flipping wa_provider moves every 1:1
 * WhatsApp send in the product onto a different transport — an unauthenticated
 * caller must not get near the write.
 */
import { describe, it, expect, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const { queryMock, readinessMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  readinessMock: vi.fn(),
}));

vi.mock('@/lib/db-pool', () => ({
  query: (...a: unknown[]) => queryMock(...a),
}));
vi.mock('@/modules/communications/whatsapp/config/waGoLive', () => ({
  getWaReadiness: (...a: unknown[]) => readinessMock(...a),
}));

import handler from '@/pages/api/communications/whatsapp/provider';

describe('PUT /api/communications/whatsapp/provider — authentication', () => {
  it('rejects an unauthenticated request with 401 and never writes', async () => {
    queryMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'PUT',
      body: { provider: 'cloud', confirm: true },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('rejects a request bearing a garbage token', async () => {
    queryMock.mockReset();
    const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
      method: 'PUT',
      headers: { authorization: 'Bearer not-a-real-token' },
      body: { provider: 'cloud', confirm: true },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
