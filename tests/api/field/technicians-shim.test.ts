/**
 * Tests for POST /api/field/technicians (legacy shim)
 *
 * Covers:
 *  1. Name normalisation: { name: 'First Last' } → firstName/lastName split, role forced to 'technician'
 *  2. 201 success path → legacy response shape { message, technician } with SELECT-fetched full row
 *  3. Inner-handler error (403) → forwarded verbatim, NOT wrapped in legacy shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockShimSql, mockUsersHandler } = vi.hoisted(() => ({
  mockShimSql: vi.fn(),
  mockUsersHandler: vi.fn(),
}));

// Strip withAuth and withErrorHandler to plain passthroughs so the module-level
// wrapping in the shim file does not interfere.
vi.mock('@/lib/auth', () => ({
  withAuth: (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
  withRole: () => (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) => handler,
}));

vi.mock('@/lib/api-error-handler', () => ({
  withErrorHandler:
    (handler: (req: NextApiRequest, res: NextApiResponse) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res),
}));

// Stub the sql instance used by the shim (createLoggedSql returns mockShimSql).
vi.mock('@/lib/db-logger', () => ({
  createLoggedSql: () => mockShimSql,
  logCreate: vi.fn(),
  logUpdate: vi.fn(),
  logDelete: vi.fn(),
}));

// Control what the inner users handler emits.
vi.mock('@/pages/api/field/users/index', () => ({
  default: mockUsersHandler,
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

// ── Import handler after mocks ─────────────────────────────────────────────────

import handler from '../../../pages/api/field/technicians/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: {},
    query: {},
    user: { id: 'user-storeman-uuid', role: 'storeman' },
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

/** Full staff row that the SELECT * FROM staff would return */
function fullStaffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staff-new-uuid',
    employee_id: 'TECH-12345678',
    first_name: 'John',
    last_name: 'Doe',
    email: null,
    phone: '+27821234567',
    status: 'active',
    department: 'Field Operations',
    position: 'Technician',
    contract_type: 'contractor',
    role: 'technician',
    account_status: 'pending',
    created_by_staff_id: 'user-storeman-uuid',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/field/technicians (legacy shim)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: name normalisation ────────────────────────────────────────────

  it('splits name into firstName/lastName and forces role to technician', async () => {
    // Arrange: inner handler captures what it receives and emits a 201
    const capturedBody: Record<string, unknown>[] = [];
    mockUsersHandler.mockImplementation(
      async (req: NextApiRequest, interceptorRes: NextApiResponse) => {
        capturedBody.push({ ...(req.body as Record<string, unknown>) });
        // Emit 201 so we can also verify the SELECT call happens
        interceptorRes.status(201).json({
          success: true,
          data: { user: { id: 'staff-new-uuid', role: 'technician', account_status: 'pending', created_by_staff_id: null } },
          message: 'Field user created successfully',
        });
      },
    );
    // Mock the SELECT returning a full row
    mockShimSql.mockResolvedValueOnce([fullStaffRow()]);

    const req = makeReq({
      body: { name: 'John Doe', phone: '+27821234567' },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Inner handler must receive split fields
    expect(capturedBody[0]).toMatchObject({
      firstName: 'John',
      lastName: 'Doe',
      role: 'technician',
      phone: '+27821234567',
    });
    // firstName/lastName override not required here — but name must NOT be forwarded
    expect(capturedBody[0]).not.toHaveProperty('name');
  });

  // ── Test 2: 201 success → legacy response shape with SELECT-fetched full row ─

  it('on inner-handler 201 → returns { message, technician } with status 201', async () => {
    const fullRow = fullStaffRow();

    mockUsersHandler.mockImplementation(
      async (_req: NextApiRequest, interceptorRes: NextApiResponse) => {
        interceptorRes.status(201).json({
          success: true,
          data: { user: { id: 'staff-new-uuid', role: 'technician', account_status: 'pending', created_by_staff_id: null } },
          message: 'Field user created successfully',
        });
      },
    );
    // SELECT * FROM staff WHERE id = 'staff-new-uuid'
    mockShimSql.mockResolvedValueOnce([fullRow]);

    const req = makeReq({
      body: { name: 'John Doe', phone: '+27821234567' },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(201);
    const body = res._json as { message: string; technician: typeof fullRow };
    expect(body.message).toBe('Technician added successfully');
    expect(body.technician).toMatchObject({
      id: 'staff-new-uuid',
      first_name: 'John',
      last_name: 'Doe',
      role: 'technician',
      account_status: 'pending',
    });
    // Confirm that the legacy shape keys exist and new-shape keys do NOT appear at top level
    expect(body).not.toHaveProperty('success');
    expect(body).not.toHaveProperty('data');
  });

  // ── Test 3: inner-handler 403 → forwarded verbatim ────────────────────────

  it('on inner-handler 403 → forwards 403 + body verbatim, no legacy wrapping', async () => {
    const innerErrorBody = {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient role to access field users' },
    };

    mockUsersHandler.mockImplementation(
      async (_req: NextApiRequest, interceptorRes: NextApiResponse) => {
        interceptorRes.status(403).json(innerErrorBody);
      },
    );

    const req = makeReq({
      // Simulate a technician caller trying to register another technician
      user: { id: 'tech-uuid', role: 'technician' },
      body: { name: 'Jane Smith', phone: '+27829999999' },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    expect(res._json).toEqual(innerErrorBody);
    // SELECT must NOT have been called — no row to fetch on error path
    expect(mockShimSql).not.toHaveBeenCalled();
    // Legacy shape must NOT appear
    const body = res._json as Record<string, unknown>;
    expect(body).not.toHaveProperty('message', 'Technician added successfully');
    expect(body).not.toHaveProperty('technician');
  });
});
