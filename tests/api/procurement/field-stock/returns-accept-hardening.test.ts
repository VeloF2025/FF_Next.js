/**
 * Hardening tests for POST /api/procurement/field-stock/returns/[returnId]/accept
 * Task C.3 — role gate, atomic transaction, stock_return_lines.status='processed',
 *             rollback on partial failure, stock_returns.status='restocked'.
 *
 * Mock pattern mirrors my-serials.test.ts (commit 20e8acf72).
 * Additional: mocks pg.Client for transaction testing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSql, mockClientQuery, mockClientConnect, mockClientEnd } = vi.hoisted(() => {
  const mockClientQuery = vi.fn();
  const mockClientConnect = vi.fn().mockResolvedValue(undefined);
  const mockClientEnd = vi.fn().mockResolvedValue(undefined);

  return { mockSql: vi.fn(), mockClientQuery, mockClientConnect, mockClientEnd };
});

vi.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
  Client: vi.fn().mockImplementation(() => ({
    connect: mockClientConnect,
    query: mockClientQuery,
    end: mockClientEnd,
  })),
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

import handler from '../../../../pages/api/procurement/field-stock/returns/[returnId]/accept';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

const RETURN_ID = 'return-uuid-1';

function makePostReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: {},
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

// ── Mock sequences ────────────────────────────────────────────────────────────

const RETURN_RECORD_WITH_ONE_LINE = {
  id: RETURN_ID,
  status: 'inspected',
  return_to_location_id: 'loc-warehouse-uuid',
  lines: [
    {
      id: 'line-uuid-1',
      stock_item_id: 'item-ont-uuid',
      serial_id: 'serial-uuid-1',
      quantity: 1,
      disposition: 'restock',
    },
  ],
};

function mockHappyPath() {
  // Pool sql calls:
  // 1. Staff + authRole lookup
  mockSql.mockResolvedValueOnce([{
    id: 'staff-stores-uuid',
    role: 'stores',
    auth_role: 'staff',
  }]);
  // 2. Get return with lines
  mockSql.mockResolvedValueOnce([RETURN_RECORD_WITH_ONE_LINE]);
  // 3. Final SELECT after commit
  mockSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    status: 'restocked',
  }]);

  // Client transaction calls (in order):
  // BEGIN, INSERT stock_quants, UPDATE stock_serials, INSERT stock_movements,
  // UPDATE stock_return_lines status='processed', UPDATE stock_returns status='restocked', COMMIT
  mockClientQuery.mockResolvedValue({ rows: [] });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /returns/[id]/accept hardening (C.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default client methods
    mockClientConnect.mockResolvedValue(undefined);
    mockClientEnd.mockResolvedValue(undefined);
  });

  it('rejects non-inspector role (technician) with 403', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'staff-tech-uuid',
      role: 'technician',
      auth_role: 'staff',
    }]);

    const req = makePostReq({ user: { id: 'user-tech-uuid', role: 'technician' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    const body = res._json as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/insufficient role/i);

    // No transaction started
    expect(mockClientConnect).not.toHaveBeenCalled();
  });

  it('admits stores role → 200', async () => {
    mockHappyPath();

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean; data: { status: string } };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('restocked');
  });

  it('marks stock_return_lines.status="processed" after disposition applied', async () => {
    mockHappyPath();

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    // Find the client.query call for updating stock_return_lines status='processed'
    const allClientCalls = mockClientQuery.mock.calls.map((call) => call[0] as string);
    const hasProcessedUpdate = allClientCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_return_lines') && s.includes("'processed'")
    );
    expect(hasProcessedUpdate).toBe(true);
  });

  it('updates stock_returns.status=restocked on full success', async () => {
    mockHappyPath();

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    // Verify stock_returns was updated to 'restocked' inside the transaction
    const allClientCalls = mockClientQuery.mock.calls.map((call) => call[0] as string);
    const hasRestockedUpdate = allClientCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
    );
    expect(hasRestockedUpdate).toBe(true);

    // Verify COMMIT was called
    const hasCommit = allClientCalls.some((s) => s === 'COMMIT');
    expect(hasCommit).toBe(true);
  });

  it('rejects supplier_return disposition with 422 and rolls back', async () => {
    // Staff lookup
    mockSql.mockResolvedValueOnce([{
      id: 'staff-stores-uuid',
      role: 'stores',
      auth_role: 'staff',
    }]);
    // Return with a supplier_return line
    mockSql.mockResolvedValueOnce([{
      id: RETURN_ID,
      status: 'inspected',
      return_to_location_id: 'loc-warehouse-uuid',
      lines: [
        {
          id: 'line-uuid-1',
          stock_item_id: 'item-ont-uuid',
          serial_id: 'serial-uuid-1',
          quantity: 1,
          disposition: 'supplier_return',
        },
      ],
    }]);

    // Client: BEGIN succeeds, then supplier_return check triggers ROLLBACK
    mockClientQuery.mockResolvedValue({ rows: [] });

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    expect(body.error.details.disposition).toMatch(/supplier_return/i);

    // ROLLBACK must have been called
    const allClientCalls = mockClientQuery.mock.calls.map((call) => call[0] as string);
    const hasRollback = allClientCalls.some((s) => s === 'ROLLBACK');
    expect(hasRollback).toBe(true);

    // COMMIT must NOT have been called
    const hasCommit = allClientCalls.some((s) => s === 'COMMIT');
    expect(hasCommit).toBe(false);
  });

  it('rolls back all changes if any single line update fails', async () => {
    // Pool sql calls
    mockSql.mockResolvedValueOnce([{
      id: 'staff-stores-uuid',
      role: 'stores',
      auth_role: 'staff',
    }]);
    mockSql.mockResolvedValueOnce([RETURN_RECORD_WITH_ONE_LINE]);

    // Client: BEGIN succeeds, first query (INSERT stock_quants) throws
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })   // BEGIN
      .mockRejectedValueOnce(new Error('DB constraint violation'));  // INSERT stock_quants

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should return 500
    expect(res._status).toBe(500);

    // ROLLBACK must have been called
    const allClientCalls = mockClientQuery.mock.calls.map((call) => call[0] as string);
    const hasRollback = allClientCalls.some((s) => s === 'ROLLBACK');
    expect(hasRollback).toBe(true);

    // Client.end() must always be called (finally block)
    expect(mockClientEnd).toHaveBeenCalled();

    // No stock_returns status='restocked' update should exist
    const hasRestockedUpdate = allClientCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
    );
    expect(hasRestockedUpdate).toBe(false);
  });
});
