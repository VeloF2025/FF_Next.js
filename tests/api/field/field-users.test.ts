/**
 * Tests for POST/GET /api/field/users
 * Generic field-user create endpoint with role-aware pending status.
 *
 * Cleanup: all test staff have phone LIKE '+27TEST%'; afterEach removes them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
}));

// ── Import handler after mocks ────────────────────────────────────────────────

import handler from '../../../pages/api/field/users/index';

// ── Helpers ──────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: {},
    query: {},
    user: { id: 'user-admin-uuid', role: 'admin' },
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

/** Minimal staff row returned by INSERT … RETURNING */
function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staff-new-uuid',
    role: 'technician',
    account_status: 'pending',
    created_by_staff_id: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/field/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup: delete test rows with phone LIKE '+27TEST%'
    // In unit tests the real DB is never called; this is a no-op here.
  });

  // 1. Stores user creates a technician → 201, account_status='pending', created_by_staff_id set
  it('stores user creates a technician → 201, pending, created_by_staff_id set', async () => {
    const insertedRow = staffRow({
      account_status: 'pending',
      created_by_staff_id: 'stores-staff-uuid',
    });
    mockSql.mockResolvedValueOnce([insertedRow]);

    const req = makeReq({
      method: 'POST',
      user: { id: 'stores-staff-uuid', role: 'storeman' },
      body: {
        firstName: 'Test',
        lastName: 'TechUser',
        phone: '+27TEST0000001',
        role: 'technician',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
    const body = res._json as { data: { user: { account_status: string; created_by_staff_id: string } } };
    expect(body.data.user.account_status).toBe('pending');
    expect(body.data.user.created_by_staff_id).toBe('stores-staff-uuid');

    // Regression guard: status='active' must be present in the INSERT values to satisfy the NOT NULL constraint
    const sqlCallArgs: unknown[] = mockSql.mock.calls[0] as unknown[];
    const allArgs = sqlCallArgs.flat(Infinity);
    expect(allArgs).toContain('active');
  });

  // 2. Admin creates a stores user → 201, account_status='active'
  it('admin creates a stores user → 201, active', async () => {
    const insertedRow = staffRow({ role: 'stores', account_status: 'active', created_by_staff_id: 'user-admin-uuid' });
    mockSql.mockResolvedValueOnce([insertedRow]);

    const req = makeReq({
      body: {
        firstName: 'Test',
        lastName: 'StoresUser',
        phone: '+27TEST0000002',
        role: 'stores',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
    const body = res._json as { data: { user: { account_status: string } } };
    expect(body.data.user.account_status).toBe('active');
  });

  // 3. Stores user tries to create a stores user → 403
  it('stores user cannot create non-technician role → 403', async () => {
    const req = makeReq({
      user: { id: 'stores-staff-uuid', role: 'storeman' },
      body: {
        firstName: 'Test',
        lastName: 'Forbidden',
        phone: '+27TEST0000003',
        role: 'stores',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  // 4. Missing role → 400
  it('missing role field → 400', async () => {
    const req = makeReq({
      body: {
        firstName: 'Test',
        lastName: 'NoRole',
        phone: '+27TEST0000004',
        // role intentionally omitted
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  // 5. Invalid role → 400
  it('invalid role value → 400', async () => {
    const req = makeReq({
      body: {
        firstName: 'Test',
        lastName: 'BadRole',
        phone: '+27TEST0000005',
        role: 'wizard',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

// ── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/field/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 6. GET filter by role='technician' returns only technicians
  it('GET ?role=technician returns technician rows only', async () => {
    const rows = [
      { id: 'st-1', first_name: 'A', last_name: 'B', phone: '+27TEST0000006', email: null, role: 'technician', account_status: 'active', created_by_staff_id: null, created_at: new Date().toISOString() },
    ];
    mockSql.mockResolvedValueOnce(rows);

    const req = makeReq({
      method: 'GET',
      query: { role: 'technician' },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { data: typeof rows };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].role).toBe('technician');
  });
});
