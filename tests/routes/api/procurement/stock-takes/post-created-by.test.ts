/**
 * POST /api/procurement/stock-takes must attribute created_by to the
 * authenticated session user, never to a value supplied in the request body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const mocks = vi.hoisted(() => ({ neonTag: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mocks.neonTag }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));

import handler from '@/pages/api/procurement/stock-takes/index';

const SESSION_USER = 'session-user-uuid';

async function post(body: Record<string, unknown>) {
  mocks.neonTag.mockResolvedValueOnce([{ ref: 'ST-0001' }]);
  mocks.neonTag.mockResolvedValueOnce([{ id: 'take-1', reference_number: 'ST-0001' }]);
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({
    method: 'POST',
    body,
  });
  (req as NextApiRequest & { user: { id: string } }).user = { id: SESSION_USER };
  await (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res);
  return res;
}

function insertValues(): unknown[] {
  // neonTag is called as a tagged template: (strings, ...values). Second call is the INSERT.
  const call = mocks.neonTag.mock.calls[1]!;
  return call.slice(1);
}

describe('POST stock-take created_by attribution', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes the session user id as created_by', async () => {
    const res = await post({ name: 'Count', location_id: 'loc-1' });
    expect(res._getStatusCode()).toBe(201);
    expect(insertValues()).toContain(SESSION_USER);
  });

  it('ignores created_by supplied in the request body', async () => {
    const res = await post({ name: 'Count', location_id: 'loc-1', created_by: 'spoofed-uuid' });
    expect(res._getStatusCode()).toBe(201);
    const values = insertValues();
    expect(values).toContain(SESSION_USER);
    expect(values).not.toContain('spoofed-uuid');
  });
});
