/**
 * Regression tests for analytics/projects/summary.ts
 *
 * Verifies that the catch→200 bug (returning {success:true} on DB error)
 * is fixed and stays fixed. See commit 9a59859e.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mockSql }));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
  withRole: () => (handler: Function) => handler,
}));

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import handler from '../../../pages/api/analytics/projects/summary';

describe('GET /api/analytics/projects/summary — error handling', () => {
  let req: Partial<NextApiRequest>;
  let res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
  let statusReturn: { json: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    statusReturn = { json: vi.fn() };
    res = {
      status: vi.fn().mockReturnValue(statusReturn),
      json: vi.fn(),
    };
    req = { method: 'GET', query: {} };
  });

  it('returns 405 for non-GET requests', async () => {
    req.method = 'POST';
    await handler(req as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('REGRESSION: returns 500 (not 200) when DB throws', async () => {
    // Simulates a DB connection failure or query error
    mockSql.mockRejectedValue(new Error('DB connection failed'));

    await handler(req as NextApiRequest, res as unknown as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(500);
    const jsonArg = statusReturn.json.mock.calls[0]?.[0];
    expect(jsonArg).toMatchObject({ success: false });
    // Explicitly verify it is NOT returning success:true (the original bug)
    expect(jsonArg?.success).not.toBe(true);
  });

  it('REGRESSION: 500 response includes error message not zeros', async () => {
    mockSql.mockRejectedValue(new Error('Connection timeout'));

    await handler(req as NextApiRequest, res as unknown as NextApiResponse);

    const jsonArg = statusReturn.json.mock.calls[0]?.[0];
    // Should NOT return zeroed-out data structure (the original bug)
    expect(jsonArg?.data).toBeUndefined();
    expect(jsonArg?.error).toBeDefined();
  });
});
