/**
 * Behavioral tests for the withPermission middleware — the RBAC gate the
 * /api/activate/reporting/* endpoints rely on. The DB-backed permission
 * check is mocked; these tests pin the middleware's decision behaviour
 * (grant → handler runs, deny → 403 FORBIDDEN, super_admin bypass,
 * check failure → structured 500, fail closed).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  userHasPermission: vi.fn(),
  sql: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db-neon', () => ({ neon: () => mocks.sql }));

vi.mock('@/lib/permissions', () => ({
  userHasPermission: mocks.userHasPermission,
}));

import { withPermission } from '@/lib/auth/middleware';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as typeof res & NextApiResponse;
}

function reqWithUser(role: string): NextApiRequest {
  return {
    user: { id: 'user-1', email: 'user@test', role },
  } as unknown as NextApiRequest;
}

describe('withPermission', () => {
  const handler = vi.fn(async (_req: NextApiRequest, res: NextApiResponse) => {
    res.status(200).json({ success: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs the handler when the permission check grants access', async () => {
    mocks.userHasPermission.mockResolvedValue(true);
    const res = mockRes();

    await withPermission('activate.reports', 'view')(handler)(reqWithUser('viewer'), res);

    expect(mocks.userHasPermission).toHaveBeenCalledWith('user-1', 'activate.reports', 'view');
    expect(handler).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('returns 403 FORBIDDEN when the permission check denies access', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const res = mockRes();

    await withPermission('activate.reports', 'view')(handler)(reqWithUser('viewer'), res);

    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });

  it('passes the requested action through to the permission check', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const res = mockRes();

    await withPermission('activate.reports', 'edit')(handler)(reqWithUser('technician'), res);

    expect(mocks.userHasPermission).toHaveBeenCalledWith('user-1', 'activate.reports', 'edit');
    expect(res.statusCode).toBe(403);
  });

  it('bypasses the DB check entirely for super_admin', async () => {
    const res = mockRes();

    await withPermission('activate.reports', 'view')(handler)(reqWithUser('super_admin'), res);

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('fails closed with structured 500 when the permission check throws', async () => {
    mocks.userHasPermission.mockRejectedValue(new Error('db unreachable'));
    const res = mockRes();

    await withPermission('activate.reports', 'view')(handler)(reqWithUser('viewer'), res);

    expect(handler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'PERMISSION_CHECK_ERROR' },
    });
  });
});
