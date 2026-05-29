/**
 * RBAC gate tests for the HOLDER block / unblock endpoints
 * (Sprint E Track 4.2, migration 389).
 *
 * These are the routes the field-stock UI actually calls
 * (pages/procurement/field-stock/index.tsx) and the ones that write
 * stock_accountability.is_blocked — the flag the Track 4.1 issue-time guard
 * (holderBlockGuard) enforces. They use @/lib/db-pool (pg.Pool), not neon.
 *
 * Both routes are wrapped in
 *   withAuth(withPermission('procurement.field-stock.block-holder', 'edit')(handler))
 *
 * The tests exercise the REAL withPermission middleware (only withAuth is
 * stubbed to inject the test user):
 *   - super_admin → bypass → 200
 *   - role without the permission → 403 FORBIDDEN, DB never touched
 *   - role with the permission → 200
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const PERMISSION_KEY = 'procurement.field-stock.block-holder';

const mocks = vi.hoisted(() => {
  const queryQueue: unknown[] = [];
  return {
    queryQueue,
    queryOne: vi.fn(() => Promise.resolve(queryQueue.shift() ?? null)),
    userHasPermission: vi.fn(),
  };
});

vi.mock('@/lib/db-pool', () => ({ queryOne: mocks.queryOne }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));
// Keep withPermission REAL; only stub withAuth so the test can inject req.user.
vi.mock('@/lib/auth/middleware', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/middleware')>('@/lib/auth/middleware');
  return { ...actual, withAuth: (h: unknown) => h };
});
vi.mock('@/lib/auth', async () => {
  const mw = await import('@/lib/auth/middleware');
  return { withAuth: mw.withAuth, withPermission: mw.withPermission };
});

import blockHandler from '../block';
import unblockHandler from '../unblock';

type TestUser = { id: string; role: string; email: string; name?: string };

function invoke(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  user: TestUser,
  body: Record<string, unknown> = {},
) {
  const { req, res } = createMocks({
    method: 'POST',
    query: { holderId: 'h-1' },
    body,
  });
  (req as unknown as { user: TestUser }).user = user;
  return { res, run: () => handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse) };
}

const SUPER_ADMIN: TestUser = { id: 'sa-1', role: 'super_admin', email: 'sa@example.com', name: 'Super' };
const ADMIN: TestUser = { id: 'admin-1', role: 'admin', email: 'admin@example.com', name: 'Ann Admin' };
const TECHNICIAN: TestUser = { id: 'tech-1', role: 'technician', email: 'tech@example.com', name: 'Tom Tech' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queryQueue.length = 0;
});

describe('POST /api/procurement/field-stock/accountability/holders/[holderId]/block — RBAC gate', () => {
  it('denies a role without the permission with 403 and never touches the DB', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const { res, run } = invoke(blockHandler, TECHNICIAN, { reason: 'theft' });

    await run();

    expect(res._getStatusCode()).toBe(403);
    expect(JSON.parse(res._getData()).error.code).toBe('FORBIDDEN');
    expect(mocks.userHasPermission).toHaveBeenCalledWith(TECHNICIAN.id, PERMISSION_KEY, 'edit');
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it('allows a role that holds the permission (200)', async () => {
    mocks.userHasPermission.mockResolvedValue(true);
    mocks.queryQueue.push(
      { id: 'h-1' }, // holder existence check
      { holder_id: 'h-1', is_blocked: true }, // upsert RETURNING
    );
    const { res, run } = invoke(blockHandler, ADMIN, { reason: 'theft' });

    await run();

    expect(mocks.userHasPermission).toHaveBeenCalledWith(ADMIN.id, PERMISSION_KEY, 'edit');
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).success).toBe(true);
  });

  it('bypasses the permission check for super_admin (200)', async () => {
    mocks.queryQueue.push({ id: 'h-1' }, { holder_id: 'h-1', is_blocked: true });
    const { res, run } = invoke(blockHandler, SUPER_ADMIN, { reason: 'theft' });

    await run();

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
  });
});

describe('POST /api/procurement/field-stock/accountability/holders/[holderId]/unblock — RBAC gate', () => {
  it('denies a role without the permission with 403 and never touches the DB', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const { res, run } = invoke(unblockHandler, TECHNICIAN);

    await run();

    expect(res._getStatusCode()).toBe(403);
    expect(JSON.parse(res._getData()).error.code).toBe('FORBIDDEN');
    expect(mocks.userHasPermission).toHaveBeenCalledWith(TECHNICIAN.id, PERMISSION_KEY, 'edit');
    expect(mocks.queryOne).not.toHaveBeenCalled();
  });

  it('allows a role that holds the permission (200)', async () => {
    mocks.userHasPermission.mockResolvedValue(true);
    mocks.queryQueue.push(
      { id: 'h-1' }, // holder existence check
      { holder_id: 'h-1', is_blocked: false }, // upsert RETURNING
    );
    const { res, run } = invoke(unblockHandler, ADMIN);

    await run();

    expect(mocks.userHasPermission).toHaveBeenCalledWith(ADMIN.id, PERMISSION_KEY, 'edit');
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).success).toBe(true);
  });

  it('bypasses the permission check for super_admin (200)', async () => {
    mocks.queryQueue.push({ id: 'h-1' }, { holder_id: 'h-1', is_blocked: false });
    const { res, run } = invoke(unblockHandler, SUPER_ADMIN);

    await run();

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
  });
});
