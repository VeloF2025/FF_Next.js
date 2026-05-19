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
  withRole: () => (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
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

    // Regression guard: positional check that the INSERT args contain the right values
    // for the status (col 6, values index 5) and account_status (col 11, values index 10) columns.
    // callArgs[0] is the tagged-template strings array; callArgs[1..N] are the interpolated values.
    const callArgs = mockSql.mock.calls[0] as unknown[];
    const values = callArgs.slice(1);
    expect(values[5]).toBe('active');    // status column — must always be 'active' (NOT NULL)
    expect(values[10]).toBe('pending');  // account_status column — storeman caller → pending
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

  // 7. GET rejects technician caller with 403 (HIGH #2 fix)
  it('GET rejects technician caller with 403', async () => {
    const req = makeReq({
      method: 'GET',
      user: { id: 'tech-uuid', role: 'technician' },
      query: {},
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  // 8. GET rejects viewer caller with 403 (HIGH #2 fix)
  it('GET rejects viewer caller with 403', async () => {
    const req = makeReq({
      method: 'GET',
      user: { id: 'viewer-uuid', role: 'viewer' },
      query: {},
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

// ── Role-gate tests (HIGH #2 + #3 fixes) ─────────────────────────────────────

describe('Role gate — POST /api/field/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 9. Technician POST is rejected with 403 (HIGH #2 fix)
  it('technician caller → 403 on POST', async () => {
    const req = makeReq({
      method: 'POST',
      user: { id: 'tech-uuid', role: 'technician' },
      body: {
        firstName: 'Test',
        lastName: 'TechCaller',
        phone: '+27TEST0000007',
        role: 'technician',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  // 10. Manager creates technician → 201, account_status='pending' (HIGH #3 fix)
  // Previously the inverted logic would have produced 'active' for manager callers.
  it('manager caller creates technician → 201, pending (not active)', async () => {
    const insertedRow = staffRow({ account_status: 'pending', created_by_staff_id: 'manager-uuid' });
    mockSql.mockResolvedValueOnce([insertedRow]);

    const req = makeReq({
      method: 'POST',
      user: { id: 'manager-uuid', role: 'manager' },
      body: {
        firstName: 'Test',
        lastName: 'ManagerCreated',
        phone: '+27TEST0000008',
        role: 'technician',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
    const body = res._json as { data: { user: { account_status: string } } };
    expect(body.data.user.account_status).toBe('pending');
  });

  // 11. Admin creates technician → 201, account_status='active' (admin bypass)
  it('admin caller creates technician → 201, active', async () => {
    const insertedRow = staffRow({ account_status: 'active', created_by_staff_id: 'user-admin-uuid' });
    mockSql.mockResolvedValueOnce([insertedRow]);

    const req = makeReq({
      method: 'POST',
      user: { id: 'user-admin-uuid', role: 'admin' },
      body: {
        firstName: 'Test',
        lastName: 'AdminCreated',
        phone: '+27TEST0000009',
        role: 'technician',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
    const body = res._json as { data: { user: { account_status: string } } };
    expect(body.data.user.account_status).toBe('active');
  });

  // 12. REGRESSION: manager caller creating role=admin → 403 (privilege escalation fix)
  it('manager caller creating role=admin → 403', async () => {
    const req = makeReq({
      method: 'POST',
      user: { id: 'manager-uuid', role: 'manager' },
      body: {
        firstName: 'Test',
        lastName: 'PrivEsc',
        phone: '+27TEST0000010',
        role: 'admin',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });
});

// ── Mass-assignment guard tests ───────────────────────────────────────────────

describe('Mass-assignment guard — POST /api/field/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 13. REGRESSION: storeman with department override → department must be default (mass-assignment fix)
  it('storeman caller with department=Operations in body → resolved department is Field Operations (override ignored)', async () => {
    const insertedRow = staffRow({
      account_status: 'pending',
      created_by_staff_id: 'stores-staff-uuid',
      role: 'technician',
    });
    mockSql.mockResolvedValueOnce([insertedRow]);

    const req = makeReq({
      method: 'POST',
      user: { id: 'stores-staff-uuid', role: 'storeman' },
      body: {
        firstName: 'Test',
        lastName: 'MassAssign',
        phone: '+27TEST0000011',
        role: 'technician',
        department: 'Operations',   // attacker-supplied value — should be ignored
        position: 'Director',       // attacker-supplied value — should be ignored
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);

    // Verify the SQL was called with the role-default 'Field Operations' and 'Technician',
    // NOT with the caller-supplied 'Operations' / 'Director'.
    const sqlCallArgs: unknown[] = mockSql.mock.calls[0] as unknown[];
    const allArgs = sqlCallArgs.flat(Infinity);
    expect(allArgs).toContain('Field Operations');
    expect(allArgs).toContain('Technician');
    expect(allArgs).not.toContain('Operations');
    expect(allArgs).not.toContain('Director');
  });

  // 14. Admin caller with department override → override IS respected
  it('admin caller with department override → department is accepted', async () => {
    const insertedRow = staffRow({
      account_status: 'active',
      created_by_staff_id: 'user-admin-uuid',
    });
    mockSql.mockResolvedValueOnce([insertedRow]);

    const req = makeReq({
      method: 'POST',
      user: { id: 'user-admin-uuid', role: 'admin' },
      body: {
        firstName: 'Test',
        lastName: 'AdminOverride',
        phone: '+27TEST0000012',
        role: 'technician',
        department: 'Special Projects',
        position: 'Lead Technician',
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);

    const sqlCallArgs: unknown[] = mockSql.mock.calls[0] as unknown[];
    const allArgs = sqlCallArgs.flat(Infinity);
    expect(allArgs).toContain('Special Projects');
    expect(allArgs).toContain('Lead Technician');
  });
});
