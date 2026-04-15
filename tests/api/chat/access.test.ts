/**
 * Regression tests for chat/access.ts
 *
 * Verifies that the catch→200 bug (returning {dataAccess:false} masking errors)
 * is fixed and stays fixed. See commit 9a59859e.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const { mockUserHasPermission } = vi.hoisted(() => ({
  mockUserHasPermission: vi.fn(),
}));

vi.mock('@/lib/permissions', () => ({ userHasPermission: mockUserHasPermission }));

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: Function) => handler,
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
}));

vi.mock('@/lib/logger', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

import handler from '../../../pages/api/chat/access';

describe('GET /api/chat/access — error handling', () => {
  let req: Partial<NextApiRequest> & { user?: { id: string } };
  let res: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  };
  let statusReturn: { json: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    statusReturn = { json: vi.fn() };
    res = {
      status: vi.fn().mockReturnValue(statusReturn),
      json: vi.fn(),
      // apiResponse.methodNotAllowed() calls res.setHeader('Allow', ...).
      setHeader: vi.fn(),
    };
    req = { method: 'GET', query: {}, user: { id: 'user-123' } };
  });

  it('returns 405 for non-GET requests', async () => {
    req.method = 'POST';
    await handler(req as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(405);
  });

  it('returns 200 with dataAccess:true when user has permission', async () => {
    mockUserHasPermission.mockResolvedValue(true);
    await handler(req as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(statusReturn.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dataAccess: true }) })
    );
  });

  it('returns 200 with dataAccess:false when user lacks permission', async () => {
    mockUserHasPermission.mockResolvedValue(false);
    await handler(req as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(statusReturn.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ dataAccess: false }) })
    );
  });

  it('REGRESSION: returns 500 (not 200) when permission check throws', async () => {
    // Simulates DB/service failure during permission check
    mockUserHasPermission.mockRejectedValue(new Error('Permission service unavailable'));

    await handler(req as NextApiRequest, res as unknown as NextApiResponse);

    expect(res.status).toHaveBeenCalledWith(500);
    // Explicitly verify it is NOT returning 200 with dataAccess:false (the original bug)
    expect(res.status).not.toHaveBeenCalledWith(200);
    const jsonArg = statusReturn.json.mock.calls[0]?.[0];
    expect(jsonArg?.error).toBeDefined();
    expect(jsonArg?.dataAccess).toBeUndefined();
  });
});
