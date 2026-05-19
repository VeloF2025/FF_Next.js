/**
 * Tests for POST /api/field/users/approve and POST /api/field/users/suspend
 * Admin-only endpoints for flipping account_status on staff rows.
 *
 * Route style: FLATTENED — userId comes from req.query (not a nested dynamic segment)
 * because no nested dynamic API routes exist in this project.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@/lib/db-pool', () => ({ sql: mockSql }));

vi.mock('@/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getLogs: vi.fn(() => []),
    clearLogs: vi.fn(),
  },
}));

vi.mock('@/lib/db-logger', () => ({
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

/**
 * Mock @/lib/auth/middleware — withAuth is transparent (passthrough).
 * withRole is transparent when called with any role, so we can test the
 * role-rejection path by having the handler check req.user.role itself.
 *
 * To test the 403 path we mock withRole to reject when the caller is below admin.
 */
vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  withRole: (requiredRole: string) =>
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
      (req: NextApiRequest, res: NextApiResponse) => {
        // Inline the same ROLE_HIERARCHY check the real middleware uses
        const ROLE_HIERARCHY: Record<string, number> = {
          super_admin: 6,
          system: 5,
          admin: 4,
          manager: 3,
          storeman: 2,
          technician: 2,
          viewer: 1,
        };
        const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callerRole = (req as any).user?.role ?? '';
        const callerLevel = ROLE_HIERARCHY[callerRole] ?? 0;
        if (callerLevel < requiredLevel) {
          return (res as NextApiResponse).status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: `This action requires ${requiredRole} role or higher` },
          });
        }
        return handler(req, res);
      },
}));

// ── Import handlers after mocks ───────────────────────────────────────────────

import approveHandler from '../../../pages/api/field/users/approve';
import suspendHandler from '../../../pages/api/field/users/suspend';

// ── Helpers ──────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: {},
    query: {},
    user: { id: 'admin-uuid', role: 'admin' },
    ...overrides,
  };
}

function makeRes(): Partial<NextApiResponse> & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, body: unknown) {
      this._json = body;
      return this;
    }),
    setHeader: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  } as Partial<NextApiResponse> & { _status: number; _json: unknown };
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/field/users/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Admin approves a pending user → 200, account_status='active'
  it('admin approves a pending user → 200, account_status=active', async () => {
    const approvedRow = { id: 'staff-pending-uuid', account_status: 'active', role: 'technician' };
    mockSql.mockResolvedValueOnce([approvedRow]);

    const req = makeReq({
      query: { userId: 'staff-pending-uuid' },
    });
    const res = makeRes();

    await approveHandler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { data: { user: { account_status: string } } };
    expect(body.data.user.account_status).toBe('active');
    expect(mockSql).toHaveBeenCalledOnce();
  });

  // 2. Approve same user again → 404 (no longer pending)
  it('approve already-active user → 404', async () => {
    mockSql.mockResolvedValueOnce([]); // 0 rows updated

    const req = makeReq({
      query: { userId: 'staff-active-uuid' },
    });
    const res = makeRes();

    await approveHandler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(404);
  });

  // 4. Non-admin caller → 403
  it('technician caller → 403 (role gate)', async () => {
    const req = makeReq({
      user: { id: 'tech-uuid', role: 'technician' },
      query: { userId: 'staff-pending-uuid' },
    });
    const res = makeRes();

    await approveHandler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

describe('POST /api/field/users/suspend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 3. Admin suspends an active user → 200, account_status='suspended'
  it('admin suspends an active user → 200, account_status=suspended', async () => {
    const suspendedRow = { id: 'staff-active-uuid', account_status: 'suspended', role: 'technician' };
    mockSql.mockResolvedValueOnce([suspendedRow]);

    const req = makeReq({
      query: { userId: 'staff-active-uuid' },
    });
    const res = makeRes();

    await suspendHandler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { data: { user: { account_status: string } } };
    expect(body.data.user.account_status).toBe('suspended');
    expect(mockSql).toHaveBeenCalledOnce();
  });

  // Suspend already-suspended → 404
  it('suspend already-suspended user → 404', async () => {
    mockSql.mockResolvedValueOnce([]);

    const req = makeReq({
      query: { userId: 'staff-suspended-uuid' },
    });
    const res = makeRes();

    await suspendHandler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(404);
  });
});
