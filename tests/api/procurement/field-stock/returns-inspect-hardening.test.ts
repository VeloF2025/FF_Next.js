/**
 * Hardening tests for POST /api/procurement/field-stock/returns/[returnId]/inspect
 * Task C.2 — role gate, server-side inspected_by, disposition validation,
 *             stock_return_lines.status='inspected' on each updated line.
 *
 * Mock pattern mirrors my-serials.test.ts (commit 20e8acf72).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  withRole: () => (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
}));

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

vi.mock('@/services/procurement/auditService', () => ({
  createAuditLog: vi.fn(),
}));

// ── Handler import (must follow all vi.mock() calls) ──────────────────────────

import handler from '../../../../pages/api/procurement/field-stock/returns/[returnId]/inspect';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

const RETURN_ID = 'return-uuid-1';

const VALID_BODY = {
  inspectionNotes: 'All items checked',
  lineDispositions: {
    'line-uuid-1': { condition: 'good', disposition: 'restock', notes: null },
  },
};

function makePostReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: VALID_BODY,
    query: { returnId: RETURN_ID },
    user: { id: 'user-stores-uuid', role: 'stores' },
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

// ── Shared mock sequences ─────────────────────────────────────────────────────

function mockHappyPath(role = 'stores') {
  // 1. Staff + authRole lookup
  mockSql.mockResolvedValueOnce([{
    id: 'staff-stores-uuid',
    role,
    first_name: 'Bob',
    last_name: 'Stores',
    auth_role: 'staff',
  }]);
  // 2. Check current status
  mockSql.mockResolvedValueOnce([{ id: RETURN_ID, status: 'pending' }]);
  // 3. UPDATE stock_returns SET status='inspected'
  mockSql.mockResolvedValueOnce([]);
  // 4. UPDATE stock_return_lines (one line)
  mockSql.mockResolvedValueOnce([]);
  // 5. SELECT full return
  mockSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    status: 'inspected',
    inspected_by: 'Bob Stores',
    lines: [],
  }]);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /returns/[id]/inspect hardening (C.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects non-inspector role (technician) with 403', async () => {
    // technician is NOT in RETURN_INSPECTOR_ROLES
    mockSql.mockResolvedValueOnce([{
      id: 'staff-tech-uuid',
      role: 'technician',
      first_name: 'Alice',
      last_name: 'Tech',
      auth_role: 'staff',
    }]);

    const req = makePostReq({ user: { id: 'user-tech-uuid', role: 'technician' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    const body = res._json as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/insufficient role/i);
  });

  it('admits stores role → 200', async () => {
    mockHappyPath('stores');

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('inspected');
  });

  it('admits super_admin authRole → 200', async () => {
    // Even with a non-inspector staff role, super_admin should pass
    mockSql.mockResolvedValueOnce([{
      id: 'staff-admin-uuid',
      role: 'technician',
      first_name: 'Super',
      last_name: 'Admin',
      auth_role: 'super_admin',
    }]);
    mockSql.mockResolvedValueOnce([{ id: RETURN_ID, status: 'pending' }]);
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([{
      id: RETURN_ID,
      status: 'inspected',
      inspected_by: 'Super Admin',
      lines: [],
    }]);

    const req = makePostReq({ user: { id: 'user-superadmin-uuid', role: 'super_admin' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
  });

  it('uses req.user staff name as inspected_by (ignores client inspectedBy field)', async () => {
    mockHappyPath('stores');

    const req = makePostReq({
      body: {
        ...VALID_BODY,
        inspectedBy: 'Evil Override', // client tries to inject a different name
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    // The UPDATE sql call should contain 'Bob Stores', NOT 'Evil Override'
    const allArgs = JSON.stringify(mockSql.mock.calls);
    expect(allArgs).toContain('Bob Stores');
    expect(allArgs).not.toContain('Evil Override');
  });

  it('rejects lineDispositions with invalid condition value → 422', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'staff-stores-uuid',
      role: 'stores',
      first_name: 'Bob',
      last_name: 'Stores',
      auth_role: 'staff',
    }]);

    const req = makePostReq({
      body: {
        lineDispositions: {
          'line-uuid-1': { condition: 'ugly', disposition: 'restock' },
        },
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    // Should mention the line id
    expect(body.error.details).toHaveProperty('line-uuid-1');
  });

  it('rejects lineDispositions with invalid disposition value → 422', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'staff-stores-uuid',
      role: 'stores',
      first_name: 'Bob',
      last_name: 'Stores',
      auth_role: 'staff',
    }]);

    const req = makePostReq({
      body: {
        lineDispositions: {
          'line-uuid-2': { condition: 'good', disposition: 'delete' },
        },
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    expect(body.error.details).toHaveProperty('line-uuid-2');
  });

  it('sets stock_return_lines.status="inspected" on each updated line', async () => {
    mockHappyPath('stores');

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    // Check that one of the UPDATE calls includes status = 'inspected'
    const callStrings = mockSql.mock.calls.map((call) => {
      const parts = call[0] as TemplateStringsArray;
      return Array.isArray(parts) ? parts.join('') : String(call[0]);
    });
    const hasInspectedStatusUpdate = callStrings.some(
      (s) => s.includes("status = 'inspected'") || s.includes('status =') && s.includes('inspected')
    );
    expect(hasInspectedStatusUpdate).toBe(true);
  });
});
