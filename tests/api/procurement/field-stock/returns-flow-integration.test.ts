/**
 * Integration tests — full return → inspect → accept lifecycle
 * Task G.1 — chains all three endpoints with shared state via mocked SQL.
 *
 * Infrastructure after FIX 2:
 *   - POST /returns       → uses @/lib/db `sql` tagged template (mockDbSql)
 *   - POST /inspect       → uses @neondatabase/serverless neon() (mockNeonSql)
 *   - POST /accept        → uses @/lib/db-pool query/queryOne (mockQueryOne/mockQuery)
 *                           and transaction() (mockTransaction / mockTxnQuery)
 *
 * Each neon() caller imports it at module scope, so the neon mock needs to be
 * hoisted before any handler imports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks (must precede all imports) ───────────────────────────────────

const { mockNeonSql, mockQuery, mockQueryOne, mockTxnQuery, mockTransaction } = vi.hoisted(() => {
  const mockNeonSql = vi.fn();
  const mockQuery = vi.fn().mockResolvedValue([]);
  const mockQueryOne = vi.fn().mockResolvedValue(null);
  const mockTxnQuery = vi.fn().mockResolvedValue([]);

  const mockTransaction = vi.fn().mockImplementation(
    async (cb: (txn: { query: typeof mockTxnQuery; queryOne: typeof mockTxnQuery }) => Promise<unknown>) => {
      mockTxnQuery('BEGIN');
      try {
        const result = await cb({ query: mockTxnQuery, queryOne: mockTxnQuery });
        mockTxnQuery('COMMIT');
        return result;
      } catch (err) {
        mockTxnQuery('ROLLBACK');
        throw err;
      }
    }
  );

  return { mockNeonSql, mockQuery, mockQueryOne, mockTxnQuery, mockTransaction };
});

// inspect.ts still uses the Neon shim — mock @neondatabase/serverless for it
vi.mock('@neondatabase/serverless', () => ({
  neon: () => mockNeonSql,
}));

// returns/index.ts (create handler) uses @/lib/db { sql }
vi.mock('@/lib/db', () => ({
  sql: mockNeonSql,
}));

// accept.ts uses @/lib/db-pool
vi.mock('@/lib/db-pool', () => ({
  query: mockQuery,
  queryOne: mockQueryOne,
  transaction: mockTransaction,
  pool: {},
  default: {},
}));

// stockHolderService uses @/lib/db-pool under the hood;
// mock it directly so accept.ts's pre-transaction holder resolution works
vi.mock('@/modules/procurement/field-stock/services/stockHolderService', () => ({
  getOrCreateStaffHolder: vi.fn().mockResolvedValue({ id: 'holder-tech-uuid' }),
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

// ── Handler imports (must follow all vi.mock() calls) ──────────────────────────

import createHandler from '../../../../pages/api/procurement/field-stock/returns/index';
import inspectHandler from '../../../../pages/api/procurement/field-stock/returns/[returnId]/inspect';
import acceptHandler from '../../../../pages/api/procurement/field-stock/returns/[returnId]/accept';

// ── Shared test fixtures ───────────────────────────────────────────────────────

const RETURN_ID = 'return-uuid-integration-1';
const TECH_USER_ID = 'user-tech-uuid';
const STORES_USER_ID = 'user-stores-uuid';
const TECH_STAFF_ID = 'staff-tech-uuid';
const STORES_STAFF_ID = 'staff-stores-uuid';
const WAREHOUSE_LOCATION_ID = 'loc-lawley-uuid';
const SERIAL_1_ID = 'serial-uuid-s1';
const SERIAL_2_ID = 'serial-uuid-s2';
const LINE_1_ID = 'line-uuid-1';
const LINE_2_ID = 'line-uuid-2';

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: {},
    query: {},
    user: { id: TECH_USER_ID, role: 'technician' },
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

// ── Mock sequence helpers ──────────────────────────────────────────────────────

/** Neon sql mocks — used by create (via @/lib/db sql) and inspect (via @neondatabase/serverless) */
function mockTechStaff() {
  mockNeonSql.mockResolvedValueOnce([{
    id: TECH_STAFF_ID,
    role: 'technician',
    first_name: 'Alice',
    last_name: 'Techie',
    auth_role: 'staff',
  }]);
}

function mockStoresStaff() {
  mockNeonSql.mockResolvedValueOnce([{
    id: STORES_STAFF_ID,
    role: 'stores',
    first_name: 'Bob',
    last_name: 'Stores',
    auth_role: 'staff',
  }]);
}

function mockDriverStaff() {
  mockNeonSql.mockResolvedValueOnce([{
    id: 'staff-driver-uuid',
    role: 'driver',
    first_name: 'Dave',
    last_name: 'Driver',
    auth_role: 'staff',
  }]);
}

function mockCreateReturn() {
  // 1. generate_return_number()
  mockNeonSql.mockResolvedValueOnce([{ num: 'RET-202605-00001' }]);
  // 2. INSERT stock_returns RETURNING *
  mockNeonSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    return_number: 'RET-202605-00001',
    status: 'pending',
    returned_by_id: TECH_STAFF_ID,
  }]);
  // 3. INSERT line 1
  mockNeonSql.mockResolvedValueOnce([]);
  // 4. INSERT line 2
  mockNeonSql.mockResolvedValueOnce([]);
  // 5. SELECT full return with lines
  mockNeonSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    return_number: 'RET-202605-00001',
    status: 'pending',
    returned_by_id: TECH_STAFF_ID,
    lines: [
      { id: LINE_1_ID, serial_id: SERIAL_1_ID, disposition: null, status: 'pending' },
      { id: LINE_2_ID, serial_id: SERIAL_2_ID, disposition: null, status: 'pending' },
    ],
  }]);
}

function mockInspectReturn() {
  // 1. Check current status
  mockNeonSql.mockResolvedValueOnce([{ id: RETURN_ID, status: 'pending' }]);
  // 2. UPDATE stock_returns SET status='inspected'
  mockNeonSql.mockResolvedValueOnce([]);
  // 3. UPDATE line 1 disposition
  mockNeonSql.mockResolvedValueOnce([]);
  // 4. UPDATE line 2 disposition
  mockNeonSql.mockResolvedValueOnce([]);
  // 5. SELECT full return
  mockNeonSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    return_number: 'RET-202605-00001',
    status: 'inspected',
    inspected_by: 'Bob Stores',
    lines: [
      { id: LINE_1_ID, serial_id: SERIAL_1_ID, disposition: 'restock', status: 'inspected' },
      { id: LINE_2_ID, serial_id: SERIAL_2_ID, disposition: 'scrap', status: 'inspected' },
    ],
  }]);
}

/**
 * Accept handler reads via db-pool queryOne (not neon).
 * queryOne calls in order: 1. staff lookup, 2. return record, 3. final fetch.
 */
function mockAcceptReturn() {
  // 1. Staff lookup (stores role)
  mockQueryOne.mockResolvedValueOnce({
    id: STORES_STAFF_ID,
    role: 'stores',
    auth_role: 'staff',
  });
  // 2. GET return with lines
  mockQueryOne.mockResolvedValueOnce({
    id: RETURN_ID,
    status: 'inspected',
    return_to_location_id: WAREHOUSE_LOCATION_ID,
    returned_by_id: TECH_STAFF_ID,
    returned_by_name: 'Alice Techie',
    contractor_id: null,
    return_number: 'RET-202605-00001',
    inspected_by: null,
    lines: [
      { id: LINE_1_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_1_ID, quantity: 1, disposition: 'restock' },
      { id: LINE_2_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_2_ID, quantity: 1, disposition: 'scrap' },
    ],
  });
  // 3. Final SELECT after transaction
  mockQueryOne.mockResolvedValueOnce({
    id: RETURN_ID,
    return_number: 'RET-202605-00001',
    status: 'restocked',
  });

  // All txn queries succeed
  mockTxnQuery.mockResolvedValue([]);
}

// ── Test suites ────────────────────────────────────────────────────────────────

describe('Returns full flow integration', () => {
  beforeEach(() => {
    mockNeonSql.mockReset();
    mockQuery.mockReset();
    mockQueryOne.mockReset();
    mockTxnQuery.mockReset();
    mockTransaction.mockReset();

    // Re-apply defaults after clearAllMocks
    mockTxnQuery.mockResolvedValue([]);
    mockTransaction.mockImplementation(
      async (cb: (txn: { query: typeof mockTxnQuery; queryOne: typeof mockTxnQuery }) => Promise<unknown>) => {
        mockTxnQuery('BEGIN');
        try {
          const result = await cb({ query: mockTxnQuery, queryOne: mockTxnQuery });
          mockTxnQuery('COMMIT');
          return result;
        } catch (err) {
          mockTxnQuery('ROLLBACK');
          throw err;
        }
      }
    );
  });

  // ── Happy path ───────────────────────────────────────────────────────────────

  describe('Happy path — tech creates → storeman inspects → accept restocks', () => {
    it('end-to-end with mixed dispositions: restock + scrap', async () => {
      const RETURN_BODY = {
        returnToLocationId: WAREHOUSE_LOCATION_ID,
        lines: [
          {
            stockItemId: 'item-ont-uuid',
            serialId: SERIAL_1_ID,
            serialNumber: 'SN-ONT-001',
            quantity: 1,
            condition: 'good',
            returnReason: 'unused',
          },
          {
            stockItemId: 'item-ont-uuid',
            serialId: SERIAL_2_ID,
            serialNumber: 'SN-ONT-002',
            quantity: 1,
            condition: 'damaged',
            returnReason: 'faulty',
          },
        ],
      };

      // ── Act 1: tech creates return ────────────────────────────────────────────
      mockTechStaff();
      mockCreateReturn();

      const createReq = makeReq({ body: RETURN_BODY });
      const createRes = makeRes();

      await createHandler(createReq as NextApiRequest, createRes as NextApiResponse);

      expect(createRes._status).toBe(201);
      const createBody = createRes._json as { success: boolean; data: { id: string; return_number: string; status: string; returned_by_id: string } };
      expect(createBody.success).toBe(true);
      expect(createBody.data.id).toBe(RETURN_ID);
      expect(createBody.data.return_number).toMatch(/^RET-/);
      expect(createBody.data.status).toBe('pending');
      // Server-side: returned_by_id must come from staff lookup, not client-supplied value
      expect(createBody.data.returned_by_id).toBe(TECH_STAFF_ID);

      // ── Act 2: storeman inspects with mixed dispositions ──────────────────────
      mockNeonSql.mockReset();
      mockTxnQuery.mockReset();
      mockTxnQuery.mockResolvedValue([]);

      mockStoresStaff();
      mockInspectReturn();

      const inspectReq = makeReq({
        query: { returnId: RETURN_ID },
        user: { id: STORES_USER_ID, role: 'stores' },
        body: {
          inspectionNotes: 'SN-001 good, SN-002 damaged',
          lineDispositions: {
            [LINE_1_ID]: { condition: 'good', disposition: 'restock', notes: null },
            [LINE_2_ID]: { condition: 'damaged', disposition: 'scrap', notes: 'cracked housing' },
          },
        },
      });
      const inspectRes = makeRes();

      await inspectHandler(inspectReq as NextApiRequest, inspectRes as NextApiResponse);

      expect(inspectRes._status).toBe(200);
      const inspectBody = inspectRes._json as { success: boolean; data: { status: string; lines: Array<{ id: string; disposition: string; status: string }> } };
      expect(inspectBody.success).toBe(true);
      expect(inspectBody.data.status).toBe('inspected');

      // Verify SQL updated lines to 'inspected' status
      const inspectCallStrings = mockNeonSql.mock.calls.map((call) => {
        const parts = call[0] as TemplateStringsArray;
        return Array.isArray(parts) ? parts.join('') : String(call[0]);
      });
      expect(inspectCallStrings.some((s) => s.includes("status = 'inspected'"))).toBe(true);

      // ── Act 3: storeman accepts — mixed restock + scrap ───────────────────────
      mockNeonSql.mockReset();
      mockQueryOne.mockReset();
      mockTxnQuery.mockReset();
      mockTxnQuery.mockResolvedValue([]);

      mockAcceptReturn();

      const acceptReq = makeReq({
        query: { returnId: RETURN_ID },
        user: { id: STORES_USER_ID, role: 'stores' },
        body: {},
      });
      const acceptRes = makeRes();

      await acceptHandler(acceptReq as NextApiRequest, acceptRes as NextApiResponse);

      expect(acceptRes._status).toBe(200);
      const acceptBody = acceptRes._json as { success: boolean; data: { status: string } };
      expect(acceptBody.success).toBe(true);
      expect(acceptBody.data.status).toBe('restocked');

      // Verify atomic transaction structure
      const txnCalls = mockTxnQuery.mock.calls.map((c) => c[0] as string);
      expect(txnCalls[0]).toBe('BEGIN');
      expect(txnCalls.some((s) => s === 'COMMIT')).toBe(true);
      expect(txnCalls.some((s) => s === 'ROLLBACK')).toBe(false);

      // Restock branch with resolved holder: custody debit (stock_custody)
      // and field_stock_movements 'return' row via postReturnFromHolderWith
      expect(txnCalls.some((s) => typeof s === 'string' && s.includes('stock_custody'))).toBe(true);
      expect(txnCalls.some((s) =>
        typeof s === 'string' && s.includes('field_stock_movements') && s.includes("'return'")
      )).toBe(true);

      // UPDATE stock_serials: restock sets status='available', holder_id=NULL
      expect(txnCalls.some((s) =>
        typeof s === 'string' && s.includes('stock_serials') && s.includes("'available'")
      )).toBe(true);

      // Scrap branch: UPDATE stock_serials status='scrapped'
      expect(txnCalls.some((s) =>
        typeof s === 'string' && s.includes('stock_serials') && s.includes("'scrapped'")
      )).toBe(true);

      // serial UPDATE must clear holder_id
      expect(txnCalls.some((s) =>
        typeof s === 'string' && s.includes('stock_serials') && s.includes('holder_id = NULL')
      )).toBe(true);

      // stock_return_lines marked 'processed' — one per line
      const processedUpdates = txnCalls.filter(
        (s) => typeof s === 'string' && s.includes('stock_return_lines') && s.includes("'processed'")
      );
      expect(processedUpdates.length).toBe(2);

      // stock_returns marked 'restocked'
      expect(txnCalls.some(
        (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
      )).toBe(true);
    });
  });

  // ── Idempotency ───────────────────────────────────────────────────────────────

  describe('Idempotency', () => {
    it('POST /returns with same idempotency_key returns existing return (200 not 201)', async () => {
      const IDEM_KEY = 'idem-integration-key-xyz';

      // First call — creates the return (single line body)
      mockTechStaff();
      // Idempotency check: no existing row found
      mockNeonSql.mockResolvedValueOnce([]);
      // generate_return_number
      mockNeonSql.mockResolvedValueOnce([{ num: 'RET-202605-00001' }]);
      // INSERT stock_returns RETURNING *
      mockNeonSql.mockResolvedValueOnce([{
        id: RETURN_ID,
        return_number: 'RET-202605-00001',
        status: 'pending',
        returned_by_id: TECH_STAFF_ID,
      }]);
      // INSERT single line
      mockNeonSql.mockResolvedValueOnce([]);
      // SELECT full return
      mockNeonSql.mockResolvedValueOnce([{
        id: RETURN_ID,
        return_number: 'RET-202605-00001',
        status: 'pending',
        returned_by_id: TECH_STAFF_ID,
        lines: [{ id: LINE_1_ID, serial_id: SERIAL_1_ID }],
      }]);

      const firstReq = makeReq({
        body: {
          returnToLocationId: WAREHOUSE_LOCATION_ID,
          lines: [
            {
              stockItemId: 'item-ont-uuid',
              serialId: SERIAL_1_ID,
              serialNumber: 'SN-ONT-001',
              quantity: 1,
              returnReason: 'unused',
            },
          ],
          idempotencyKey: IDEM_KEY,
        },
      });
      const firstRes = makeRes();

      await createHandler(firstReq as NextApiRequest, firstRes as NextApiResponse);

      expect(firstRes._status).toBe(201);
      const firstBody = firstRes._json as { success: boolean; data: { id: string; return_number: string } };
      const createdId = firstBody.data.id;
      const createdNumber = firstBody.data.return_number;

      // Second call — reset only neon sql
      mockNeonSql.mockReset();

      mockTechStaff();
      // Idempotency check: existing row found
      mockNeonSql.mockResolvedValueOnce([{
        id: createdId,
        return_number: createdNumber,
        status: 'pending',
      }]);

      const secondReq = makeReq({
        body: {
          returnToLocationId: WAREHOUSE_LOCATION_ID,
          lines: [
            {
              stockItemId: 'item-ont-uuid',
              serialId: SERIAL_1_ID,
              serialNumber: 'SN-ONT-001',
              quantity: 1,
              returnReason: 'unused',
            },
          ],
          idempotencyKey: IDEM_KEY,
        },
      });
      const secondRes = makeRes();

      await createHandler(secondReq as NextApiRequest, secondRes as NextApiResponse);

      // Should return 200 (not 201) with the SAME id and number
      expect(secondRes._status).toBe(200);
      const secondBody = secondRes._json as { success: boolean; data: { id: string; return_number: string } };
      expect(secondBody.success).toBe(true);
      expect(secondBody.data.id).toBe(createdId);
      expect(secondBody.data.return_number).toBe(createdNumber);

      // Only 2 SQL calls on the second request: staff lookup + idempotency check (no INSERT)
      expect(mockNeonSql).toHaveBeenCalledTimes(2);
    });
  });

  // ── Authorisation ─────────────────────────────────────────────────────────────

  describe('Authorisation', () => {
    it('POST /returns rejects user with no staff link → 403', async () => {
      // Staff lookup returns empty
      mockNeonSql.mockResolvedValueOnce([]);

      const req = makeReq({
        body: {
          returnToLocationId: WAREHOUSE_LOCATION_ID,
          lines: [{ stockItemId: 'item-ont-uuid', quantity: 1 }],
        },
      });
      const res = makeRes();

      await createHandler(req as NextApiRequest, res as NextApiResponse);

      expect(res._status).toBe(403);
      const body = res._json as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toMatch(/no staff record/i);
    });

    it('POST /returns rejects driver-role staff → 403 (not in RETURN_CREATOR_ROLES)', async () => {
      mockDriverStaff();

      const req = makeReq({
        user: { id: 'user-driver-uuid', role: 'driver' },
        body: {
          returnToLocationId: WAREHOUSE_LOCATION_ID,
          lines: [{ stockItemId: 'item-ont-uuid', quantity: 1 }],
        },
      });
      const res = makeRes();

      await createHandler(req as NextApiRequest, res as NextApiResponse);

      expect(res._status).toBe(403);
      const body = res._json as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toMatch(/insufficient role/i);
    });

    it('POST /returns/[id]/inspect rejects technician → 403', async () => {
      // Technician is not in RETURN_INSPECTOR_ROLES
      mockNeonSql.mockResolvedValueOnce([{
        id: TECH_STAFF_ID,
        role: 'technician',
        first_name: 'Alice',
        last_name: 'Tech',
        auth_role: 'staff',
      }]);

      const req = makeReq({
        query: { returnId: RETURN_ID },
        user: { id: TECH_USER_ID, role: 'technician' },
        body: {
          lineDispositions: {
            [LINE_1_ID]: { condition: 'good', disposition: 'restock' },
          },
        },
      });
      const res = makeRes();

      await inspectHandler(req as NextApiRequest, res as NextApiResponse);

      expect(res._status).toBe(403);
      const body = res._json as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toMatch(/insufficient role/i);

      // No DB writes: only the staff lookup SQL was called
      expect(mockNeonSql).toHaveBeenCalledTimes(1);
    });

    it('POST /returns/[id]/accept rejects technician → 403', async () => {
      // accept.ts now uses queryOne for staff lookup
      mockQueryOne.mockResolvedValueOnce({
        id: TECH_STAFF_ID,
        role: 'technician',
        auth_role: 'staff',
      });

      const req = makeReq({
        query: { returnId: RETURN_ID },
        user: { id: TECH_USER_ID, role: 'technician' },
        body: {},
      });
      const res = makeRes();

      await acceptHandler(req as NextApiRequest, res as NextApiResponse);

      expect(res._status).toBe(403);
      const body = res._json as { success: boolean; error: { message: string } };
      expect(body.success).toBe(false);
      expect(body.error.message).toMatch(/insufficient role/i);

      // No transaction started
      expect(mockTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Validation ────────────────────────────────────────────────────────────────

  describe('Validation', () => {
    it('POST /returns rejects line with invalid returnReason → 422', async () => {
      mockTechStaff();

      const req = makeReq({
        body: {
          returnToLocationId: WAREHOUSE_LOCATION_ID,
          lines: [
            {
              stockItemId: 'item-ont-uuid',
              quantity: 1,
              returnReason: 'lost_in_magic', // not in VALID_RETURN_REASONS
            },
          ],
        },
      });
      const res = makeRes();

      await createHandler(req as NextApiRequest, res as NextApiResponse);

      expect(res._status).toBe(422);
      const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
      expect(body.success).toBe(false);
      expect(body.error.details).toHaveProperty('returnReason');

      // Validation fires before any INSERT
      const callStrings = mockNeonSql.mock.calls.map((c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim());
      expect(callStrings.some((s) => s.startsWith('INSERT'))).toBe(false);
    });

    it('POST /returns/[id]/inspect rejects invalid disposition "delete" → 422', async () => {
      mockStoresStaff();

      const req = makeReq({
        query: { returnId: RETURN_ID },
        user: { id: STORES_USER_ID, role: 'stores' },
        body: {
          lineDispositions: {
            [LINE_1_ID]: { condition: 'good', disposition: 'delete' }, // 'delete' is not valid
          },
        },
      });
      const res = makeRes();

      await inspectHandler(req as NextApiRequest, res as NextApiResponse);

      expect(res._status).toBe(422);
      const body = res._json as { success: boolean; error: { code: string; details: Record<string, string> } };
      expect(body.success).toBe(false);
      // Error details should be keyed to the failing line id
      expect(body.error.details).toHaveProperty(LINE_1_ID);
      expect(body.error.details[LINE_1_ID]).toMatch(/delete/i);

      // No DB writes: only staff lookup, validation aborts before any UPDATE
      expect(mockNeonSql).toHaveBeenCalledTimes(1);
    });
  });

  // ── Atomic accept rollback ────────────────────────────────────────────────────

  describe('Atomic accept', () => {
    it('rolls back all changes if one line update fails', async () => {
      // accept.ts staff lookup + return record via queryOne
      mockQueryOne
        .mockResolvedValueOnce({ id: STORES_STAFF_ID, role: 'stores', auth_role: 'staff' })
        .mockResolvedValueOnce({
          id: RETURN_ID,
          status: 'inspected',
          return_to_location_id: WAREHOUSE_LOCATION_ID,
          returned_by_id: TECH_STAFF_ID,
          returned_by_name: 'Alice Tech',
          contractor_id: null,
          return_number: 'RET-202605-00001',
          inspected_by: null,
          lines: [
            { id: LINE_1_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_1_ID, quantity: 1, disposition: 'restock' },
            { id: LINE_2_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_2_ID, quantity: 1, disposition: 'scrap' },
          ],
        });

      // BEGIN succeeds, then first line's custody SQL throws (constraint violation)
      mockTxnQuery
        .mockResolvedValueOnce([])                              // BEGIN
        .mockRejectedValueOnce(new Error('constraint violation: stock_custody_unique'));  // custody debit

      const req = makeReq({
        query: { returnId: RETURN_ID },
        user: { id: STORES_USER_ID, role: 'stores' },
        body: {},
      });
      const res = makeRes();

      await acceptHandler(req as NextApiRequest, res as NextApiResponse);

      // Should return 500
      expect(res._status).toBe(500);

      // ROLLBACK must have been called (the contract — real DB enforces the actual undo)
      const txnCalls = mockTxnQuery.mock.calls.map((c) => c[0] as string);
      expect(txnCalls.some((s) => s === 'ROLLBACK')).toBe(true);

      // COMMIT must NOT have been called
      expect(txnCalls.some((s) => s === 'COMMIT')).toBe(false);

      // No stock_returns status='restocked' update
      expect(txnCalls.some(
        (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
      )).toBe(false);

      // No stock_return_lines status='processed' update (never reached after first line failed)
      expect(txnCalls.some(
        (s) => typeof s === 'string' && s.includes('stock_return_lines') && s.includes("'processed'")
      )).toBe(false);
    });
  });
});
