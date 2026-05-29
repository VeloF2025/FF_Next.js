/**
 * RBAC gate tests for the accountability block / unblock endpoints
 * (Sprint E Track 4.2, migration 389).
 *
 * Both routes are wrapped in
 *   withAuth(withPermission('procurement.field-stock.block-holder', 'edit')(handler))
 *
 * These tests exercise the REAL withPermission middleware (only withAuth is
 * stubbed to inject the test user) so the 403/200 assertions reflect the
 * actual gate, not a passthrough:
 *   - super_admin → bypass (userHasPermission never consulted) → 200
 *   - role without the permission → 403 FORBIDDEN, handler/DB never touched
 *   - role with the permission → handler runs → 200
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const PERMISSION_KEY = 'procurement.field-stock.block-holder';

const mocks = vi.hoisted(() => {
  const sqlQueue: unknown[] = [];
  return {
    sqlQueue,
    // neon tagged-template stand-in: shifts the next queued result per query
    sql: vi.fn(() => Promise.resolve(sqlQueue.shift() ?? [])),
    userHasPermission: vi.fn(),
    createAuditLog: vi.fn(),
  };
});

vi.mock('@neondatabase/serverless', () => ({ neon: () => mocks.sql }));
vi.mock('@/lib/db-neon', () => ({ neon: () => mocks.sql }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/permissions', () => ({ userHasPermission: mocks.userHasPermission }));
vi.mock('@/services/procurement/auditService', () => ({ createAuditLog: mocks.createAuditLog }));
// Keep withPermission REAL; only stub withAuth so the test can inject req.user.
// Mock the middleware module (where withPermission lives) and have the
// @/lib/auth barrel re-export from it, so the routes' `@/lib/auth` import
// resolves to the same (real withPermission, stubbed withAuth) pair.
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

type TestUser = { id: string; role: string; email: string };

function invoke(
  handler: (req: NextApiRequest, res: NextApiResponse) => unknown,
  user: TestUser,
  body: Record<string, unknown>,
) {
  const { req, res } = createMocks({
    method: 'POST',
    query: { contractorId: 'c-1' },
    body,
  });
  (req as unknown as { user: TestUser }).user = user;
  return { res, run: () => handler(req as unknown as NextApiRequest, res as unknown as NextApiResponse) };
}

const SUPER_ADMIN: TestUser = { id: 'sa-1', role: 'super_admin', email: 'sa@example.com' };
const ADMIN: TestUser = { id: 'admin-1', role: 'admin', email: 'admin@example.com' };
const TECHNICIAN: TestUser = { id: 'tech-1', role: 'technician', email: 'tech@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sqlQueue.length = 0;
});

describe('POST /api/procurement/field-stock/accountability/[contractorId]/block — RBAC gate', () => {
  it('denies a role without the permission with 403 and never touches the DB', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const { res, run } = invoke(blockHandler, TECHNICIAN, { reason: 'theft', blockedBy: 'Hein' });

    await run();

    expect(res._getStatusCode()).toBe(403);
    expect(JSON.parse(res._getData()).error.code).toBe('FORBIDDEN');
    expect(mocks.userHasPermission).toHaveBeenCalledWith(TECHNICIAN.id, PERMISSION_KEY, 'edit');
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('allows a role that holds the permission (200)', async () => {
    mocks.userHasPermission.mockResolvedValue(true);
    mocks.sqlQueue.push(
      [{ id: 'acc-1', is_blocked: false }], // existence check
      [{ id: 'acc-1', is_blocked: true }], // UPDATE ... RETURNING
      [], // history INSERT
    );
    const { res, run } = invoke(blockHandler, ADMIN, { reason: 'theft', blockedBy: 'Hein' });

    await run();

    expect(mocks.userHasPermission).toHaveBeenCalledWith(ADMIN.id, PERMISSION_KEY, 'edit');
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).success).toBe(true);
  });

  it('bypasses the permission check for super_admin (200)', async () => {
    mocks.sqlQueue.push(
      [{ id: 'acc-1', is_blocked: false }],
      [{ id: 'acc-1', is_blocked: true }],
      [],
    );
    const { res, run } = invoke(blockHandler, SUPER_ADMIN, { reason: 'theft', blockedBy: 'Hein' });

    await run();

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
  });
});

describe('POST /api/procurement/field-stock/accountability/[contractorId]/unblock — RBAC gate', () => {
  it('denies a role without the permission with 403 and never touches the DB', async () => {
    mocks.userHasPermission.mockResolvedValue(false);
    const { res, run } = invoke(unblockHandler, TECHNICIAN, { unblockedBy: 'Hein' });

    await run();

    expect(res._getStatusCode()).toBe(403);
    expect(JSON.parse(res._getData()).error.code).toBe('FORBIDDEN');
    expect(mocks.userHasPermission).toHaveBeenCalledWith(TECHNICIAN.id, PERMISSION_KEY, 'edit');
    expect(mocks.sql).not.toHaveBeenCalled();
  });

  it('allows a role that holds the permission (200)', async () => {
    mocks.userHasPermission.mockResolvedValue(true);
    mocks.sqlQueue.push(
      [{ id: 'acc-1', is_blocked: true }], // existence check (must be blocked to unblock)
      [{ id: 'acc-1', is_blocked: false }], // UPDATE ... RETURNING
      [], // history INSERT
    );
    const { res, run } = invoke(unblockHandler, ADMIN, { unblockedBy: 'Hein' });

    await run();

    expect(mocks.userHasPermission).toHaveBeenCalledWith(ADMIN.id, PERMISSION_KEY, 'edit');
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData()).success).toBe(true);
  });

  it('bypasses the permission check for super_admin (200)', async () => {
    mocks.sqlQueue.push(
      [{ id: 'acc-1', is_blocked: true }],
      [{ id: 'acc-1', is_blocked: false }],
      [],
    );
    const { res, run } = invoke(unblockHandler, SUPER_ADMIN, { unblockedBy: 'Hein' });

    await run();

    expect(mocks.userHasPermission).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
  });
});
