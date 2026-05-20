/**
 * Hardening tests for POST /api/procurement/field-stock/returns
 * Task C.1 — role gate, idempotency, server-side returned_by, input validation,
 *             generate_return_number() usage.
 *
 * Mock pattern mirrors my-serials.test.ts (commit 20e8acf72):
 *   - @neondatabase/serverless hoisted + mocked before handler import
 *   - @/lib/auth withAuth passthrough mock
 *   - @/lib/logger silenced
 *   - user injected via req.user (withAuth stripped by mock)
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

// ── Handler import (must follow all vi.mock() calls) ──────────────────────────

import handler from '../../../../pages/api/procurement/field-stock/returns/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

const VALID_BODY = {
  returnToLocationId: 'loc-warehouse-uuid',
  lines: [
    {
      stockItemId: 'item-ont-uuid',
      serialId: 'serial-uuid-1',
      serialNumber: 'SN-001',
      quantity: 1,
      condition: 'good',
      returnReason: 'unused',
    },
  ],
};

function makePostReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: VALID_BODY,
    query: {},
    user: { id: 'user-tech-uuid', role: 'technician' },
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

function mockHappyPath(staffId = 'staff-tech-uuid') {
  // 1. Staff + authRole lookup
  mockSql.mockResolvedValueOnce([{
    id: staffId,
    role: 'technician',
    first_name: 'Alice',
    last_name: 'Techie',
    auth_role: 'staff',
  }]);
  // 2. generate_return_number()
  mockSql.mockResolvedValueOnce([{ num: 'RET-202605-00001' }]);
  // 3. INSERT stock_returns RETURNING *
  mockSql.mockResolvedValueOnce([{
    id: 'return-uuid-1',
    return_number: 'RET-202605-00001',
    status: 'pending',
    returned_by_id: staffId,
  }]);
  // 4. INSERT stock_return_lines (one line, no return)
  mockSql.mockResolvedValueOnce([]);
  // 5. SELECT for full return with lines
  mockSql.mockResolvedValueOnce([{
    id: 'return-uuid-1',
    return_number: 'RET-202605-00001',
    status: 'pending',
    returned_by_id: staffId,
    lines: [],
  }]);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /returns hardening (C.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects when caller has no staff row → 403', async () => {
    // Staff lookup returns empty array
    mockSql.mockResolvedValueOnce([]);

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    const body = res._json as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/no staff record/i);
  });

  it('rejects when caller has a non-creator role (driver) → 403', async () => {
    // Staff lookup returns a driver role — not in RETURN_CREATOR_ROLES
    mockSql.mockResolvedValueOnce([{
      id: 'staff-driver-uuid',
      role: 'driver',
      first_name: 'Dave',
      last_name: 'Driver',
      auth_role: 'staff',
    }]);

    const req = makePostReq({ user: { id: 'user-driver-uuid', role: 'driver' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    const body = res._json as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/insufficient role/i);
  });

  it('admits technician staff.role → 201', async () => {
    mockHappyPath();

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
    const body = res._json as { success: boolean; data: { return_number: string } };
    expect(body.success).toBe(true);
    expect(body.data.return_number).toBe('RET-202605-00001');
  });

  it('admits super_admin authRole even with staff role not in RETURN_CREATOR_ROLES → 201', async () => {
    // Staff exists but has a 'viewer' role — auth_role=super_admin should bypass
    mockSql.mockResolvedValueOnce([{
      id: 'staff-admin-uuid',
      role: 'viewer',
      first_name: 'Super',
      last_name: 'Admin',
      auth_role: 'super_admin',
    }]);
    // generate_return_number
    mockSql.mockResolvedValueOnce([{ num: 'RET-202605-00002' }]);
    // INSERT stock_returns
    mockSql.mockResolvedValueOnce([{
      id: 'return-uuid-2',
      return_number: 'RET-202605-00002',
      status: 'pending',
      returned_by_id: 'staff-admin-uuid',
    }]);
    // INSERT lines
    mockSql.mockResolvedValueOnce([]);
    // SELECT full return
    mockSql.mockResolvedValueOnce([{
      id: 'return-uuid-2',
      return_number: 'RET-202605-00002',
      status: 'pending',
      lines: [],
    }]);

    const req = makePostReq({ user: { id: 'user-superadmin-uuid', role: 'super_admin' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
  });

  it('dedupes on idempotency_key — second submit returns same id, status 200 not 201', async () => {
    const idempotencyKey = 'idem-key-abc123';

    // 1. Staff lookup
    mockSql.mockResolvedValueOnce([{
      id: 'staff-tech-uuid',
      role: 'technician',
      first_name: 'Alice',
      last_name: 'Techie',
      auth_role: 'staff',
    }]);
    // 2. Idempotency check — matching row found
    mockSql.mockResolvedValueOnce([{
      id: 'return-uuid-existing',
      return_number: 'RET-202605-00001',
      status: 'pending',
    }]);

    const req = makePostReq({
      body: { ...VALID_BODY, idempotencyKey },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should return 200, not 201
    expect(res._status).toBe(200);
    const body = res._json as { success: boolean; data: { id: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('return-uuid-existing');

    // Only 2 SQL calls: staff lookup + idempotency check (no INSERT)
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('derives returned_by_id from req.user staff — ignores client value', async () => {
    const realStaffId = 'staff-real-uuid';
    mockHappyPath(realStaffId);

    const req = makePostReq({
      body: {
        ...VALID_BODY,
        returnedById: 'fake-staff-uuid', // client tries to override
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);

    // The INSERT call (3rd mockSql call: staff, generate_return_number, INSERT)
    // must contain the real staffId, not 'fake-staff-uuid'
    const insertCall = mockSql.mock.calls[2];
    // The tagged template call is an array; check the strings contain returned_by_id
    // and verify by checking the data body returned has correct id
    const body = res._json as { success: boolean; data: { returned_by_id: string } };
    expect(body.success).toBe(true);
    // The mock returns realStaffId in the INSERT response
    expect(body.data.returned_by_id).toBe(realStaffId);

    // Confirm 'fake-staff-uuid' never appeared in any SQL call arguments
    const allArgs = JSON.stringify(mockSql.mock.calls);
    expect(allArgs).not.toContain('fake-staff-uuid');
  });

  it('rejects line with missing stockItemId → 422', async () => {
    // Staff lookup succeeds
    mockSql.mockResolvedValueOnce([{
      id: 'staff-tech-uuid',
      role: 'technician',
      first_name: 'Alice',
      last_name: 'Techie',
      auth_role: 'staff',
    }]);

    const req = makePostReq({
      body: {
        returnToLocationId: 'loc-warehouse-uuid',
        lines: [{ stockItemId: '', quantity: 1 }], // empty stockItemId
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    expect(body.error.details).toHaveProperty('stockItemId');
  });

  it('rejects line with invalid returnReason → 422', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'staff-tech-uuid',
      role: 'technician',
      first_name: 'Alice',
      last_name: 'Techie',
      auth_role: 'staff',
    }]);

    const req = makePostReq({
      body: {
        returnToLocationId: 'loc-warehouse-uuid',
        lines: [{ stockItemId: 'item-ont-uuid', returnReason: 'foo', quantity: 1 }],
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    expect(body.error.details).toHaveProperty('returnReason');
  });

  it('rejects line with invalid condition → 422', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'staff-tech-uuid',
      role: 'technician',
      first_name: 'Alice',
      last_name: 'Techie',
      auth_role: 'staff',
    }]);

    const req = makePostReq({
      body: {
        returnToLocationId: 'loc-warehouse-uuid',
        lines: [{ stockItemId: 'item-ont-uuid', condition: 'ugly', quantity: 1 }],
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    expect(body.error.details).toHaveProperty('condition');
  });

  it('uses generate_return_number() for number generation (no COUNT-based fallback)', async () => {
    mockHappyPath();

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);

    // Verify one of the SQL calls contains generate_return_number
    const callStrings = mockSql.mock.calls.map((call) => {
      const parts = call[0] as TemplateStringsArray;
      return Array.isArray(parts) ? parts.join('') : String(call[0]);
    });
    const hasGenerateCall = callStrings.some((s) => s.includes('generate_return_number'));
    expect(hasGenerateCall).toBe(true);

    // Confirm no COUNT(*) call (old approach)
    const hasCountCall = callStrings.some((s) => s.includes('COUNT(*)'));
    expect(hasCountCall).toBe(false);
  });
});
