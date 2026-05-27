/**
 * Hardening tests for POST /api/procurement/field-stock/returns/[returnId]/accept
 * Task C.3 — role gate, atomic transaction, stock_return_lines.status='processed',
 *             rollback on partial failure, stock_returns.status='restocked'.
 *
 * Mock pattern: @/lib/db-pool (query/queryOne for reads, transaction for writes).
 * FIX 2 removed the Neon shim from accept.ts; all DB access is now via db-pool.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockQuery, mockQueryOne, mockTxnQuery, mockTransaction } = vi.hoisted(() => {
  const mockTxnQuery = vi.fn().mockResolvedValue([]);

  // transaction(cb) — simulate real BEGIN/COMMIT/ROLLBACK around the callback
  const mockTransaction = vi.fn().mockImplementation(async (cb: (txn: { query: typeof mockTxnQuery; queryOne: typeof mockTxnQuery }) => Promise<unknown>) => {
    mockTxnQuery('BEGIN');
    try {
      const result = await cb({ query: mockTxnQuery, queryOne: mockTxnQuery });
      mockTxnQuery('COMMIT');
      return result;
    } catch (err) {
      mockTxnQuery('ROLLBACK');
      throw err;
    }
  });

  const mockQuery = vi.fn().mockResolvedValue([]);
  const mockQueryOne = vi.fn().mockResolvedValue(null);

  return { mockQuery, mockQueryOne, mockTxnQuery, mockTransaction };
});

vi.mock('@/lib/db-pool', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
  pool: {},
  default: {},
}));

vi.mock('@/modules/procurement/field-stock/services/stockHolderService', () => ({
  getOrCreateStaffHolder: vi.fn().mockResolvedValue({ id: 'holder-staff-uuid' }),
  getOrCreateContractorHolder: vi.fn().mockResolvedValue({ id: 'holder-contractor-uuid' }),
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

const STAFF_ROW = { id: 'staff-stores-uuid', role: 'stores', auth_role: 'staff' };

const RETURN_RECORD_WITH_ONE_LINE = {
  id: RETURN_ID,
  status: 'inspected',
  return_to_location_id: 'loc-warehouse-uuid',
  returned_by_id: 'staff-tech-uuid',
  returned_by_name: 'Alice Tech',
  contractor_id: null,
  return_number: 'RET-001',
  inspected_by: null,
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

const RESTOCKED_RETURN = { id: RETURN_ID, status: 'restocked' };

/**
 * Setup the happy-path mock sequence.
 * queryOne calls (in order): 1. staff/role lookup, 2. return record fetch,
 *                            3. final SELECT after transaction.
 * txnQuery: all succeed, returning empty rows.
 */
function mockHappyPath() {
  mockQueryOne
    .mockResolvedValueOnce(STAFF_ROW)
    .mockResolvedValueOnce(RETURN_RECORD_WITH_ONE_LINE)
    .mockResolvedValueOnce(RESTOCKED_RETURN);

  mockTxnQuery.mockResolvedValue([]);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /returns/[id]/accept hardening (C.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply transaction mock (clearAllMocks resets implementations)
    mockTransaction.mockImplementation(async (cb: (txn: { query: typeof mockTxnQuery; queryOne: typeof mockTxnQuery }) => Promise<unknown>) => {
      mockTxnQuery('BEGIN');
      try {
        const result = await cb({ query: mockTxnQuery, queryOne: mockTxnQuery });
        mockTxnQuery('COMMIT');
        return result;
      } catch (err) {
        mockTxnQuery('ROLLBACK');
        throw err;
      }
    });
    mockTxnQuery.mockResolvedValue([]);
  });

  it('rejects non-inspector role (technician) with 403', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'staff-tech-uuid',
      role: 'technician',
      auth_role: 'staff',
    });

    const req = makePostReq({ user: { id: 'user-tech-uuid', role: 'technician' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(403);
    const body = res._json as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.message).toMatch(/insufficient role/i);

    // No transaction started
    expect(mockTransaction).not.toHaveBeenCalled();
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

    // Find the txn.query call for updating stock_return_lines status='processed'
    const allTxnCalls = mockTxnQuery.mock.calls.map((call) => call[0] as string);
    const hasProcessedUpdate = allTxnCalls.some(
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
    const allTxnCalls = mockTxnQuery.mock.calls.map((call) => call[0] as string);
    const hasRestockedUpdate = allTxnCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
    );
    expect(hasRestockedUpdate).toBe(true);

    // Verify COMMIT was emitted
    const hasCommit = allTxnCalls.some((s) => s === 'COMMIT');
    expect(hasCommit).toBe(true);
  });

  it('rejects supplier_return disposition with 422 and rolls back', async () => {
    // Staff lookup + return record with supplier_return disposition
    mockQueryOne
      .mockResolvedValueOnce(STAFF_ROW)
      .mockResolvedValueOnce({
        id: RETURN_ID,
        status: 'inspected',
        return_to_location_id: 'loc-warehouse-uuid',
        returned_by_id: null,
        contractor_id: null,
        return_number: 'RET-001',
        inspected_by: null,
        lines: [
          {
            id: 'line-uuid-1',
            stock_item_id: 'item-ont-uuid',
            serial_id: 'serial-uuid-1',
            quantity: 1,
            disposition: 'supplier_return',
          },
        ],
      });

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
    expect(body.success).toBe(false);
    expect(body.error.details.disposition).toMatch(/supplier_return/i);

    // ROLLBACK must have been called (transaction caught the thrown error)
    const allTxnCalls = mockTxnQuery.mock.calls.map((call) => call[0] as string);
    const hasRollback = allTxnCalls.some((s) => s === 'ROLLBACK');
    expect(hasRollback).toBe(true);

    // COMMIT must NOT have been called
    const hasCommit = allTxnCalls.some((s) => s === 'COMMIT');
    expect(hasCommit).toBe(false);
  });

  it('rolls back all changes if any single line update fails', async () => {
    // Staff lookup + return record
    mockQueryOne
      .mockResolvedValueOnce(STAFF_ROW)
      .mockResolvedValueOnce(RETURN_RECORD_WITH_ONE_LINE);

    // BEGIN succeeds, then the first txn.query (custody debit) throws
    mockTxnQuery
      .mockResolvedValueOnce([])   // BEGIN
      .mockRejectedValueOnce(new Error('DB constraint violation'));

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Should return 500
    expect(res._status).toBe(500);

    // ROLLBACK must have been called
    const allTxnCalls = mockTxnQuery.mock.calls.map((call) => call[0] as string);
    const hasRollback = allTxnCalls.some((s) => s === 'ROLLBACK');
    expect(hasRollback).toBe(true);

    // No stock_returns status='restocked' update should exist
    const hasRestockedUpdate = allTxnCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
    );
    expect(hasRestockedUpdate).toBe(false);
  });

  // ── NEW: custody return path coverage (flagged by blind review) ───────────────

  it('RETURNABLE + resolved holder → postReturnFromHolderWith runs (custody + movement SQL in txn)', async () => {
    // Staff lookup, return record with returned_by_id → holder will be resolved,
    // final fetch
    mockQueryOne
      .mockResolvedValueOnce(STAFF_ROW)
      .mockResolvedValueOnce(RETURN_RECORD_WITH_ONE_LINE)
      .mockResolvedValueOnce(RESTOCKED_RETURN);

    mockTxnQuery.mockResolvedValue([]);

    const req = makePostReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    // Verify the custody debit (stock_custody) and return movement
    // (field_stock_movements 'return') ran inside the transaction
    const allTxnCalls = mockTxnQuery.mock.calls.map((call) => call[0] as string);
    const hasCustodyDebit = allTxnCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_custody')
    );
    expect(hasCustodyDebit).toBe(true);

    const hasReturnMovement = allTxnCalls.some(
      (s) => typeof s === 'string' && s.includes('field_stock_movements') && s.includes("'return'")
    );
    expect(hasReturnMovement).toBe(true);

    // serial UPDATE must set holder_id = NULL
    const hasHolderNullUpdate = allTxnCalls.some(
      (s) => typeof s === 'string' && s.includes('stock_serials') && s.includes('holder_id = NULL')
    );
    expect(hasHolderNullUpdate).toBe(true);
  });
});
