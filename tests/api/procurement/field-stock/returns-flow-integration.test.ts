/**
 * Integration tests — full return → inspect → accept lifecycle
 * Task G.1 — chains all three endpoints with shared state via mocked SQL.
 *
 * Infrastructure: mocked SQL (vi.hoisted + @neondatabase/serverless mock).
 * This is intentionally more thorough than the per-endpoint hardening tests:
 * we thread one logical return through all three handlers and assert cross-handler
 * side effects (status transitions, SQL call ordering, rollback contract).
 *
 * Handler notes (from reading the source):
 *   - POST /returns       → uses neon() tag fn (mockSql)
 *   - POST /inspect       → uses neon() tag fn (mockSql)
 *   - POST /accept        → uses BOTH neon() tag fn (mockSql for reads)
 *                           AND new Client() for the atomic transaction (mockClientQuery)
 *
 * Each handler module-imports neon() at file scope, so all three share the
 * same mockSql spy if the mock is hoisted before any import.
 *
 * Known status-code quirk (mirrors pickings-issue-flow-integration.test.ts):
 *   POST /returns calls res.status(201) then apiResponse.created(), which works
 *   correctly — apiResponse.created() sets 201 itself. Status will be 201.
 *   POST /inspect and POST /accept call apiResponse.success() which sets 200.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks (must precede all imports) ───────────────────────────────────

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

function mockTechStaff() {
  mockSql.mockResolvedValueOnce([{
    id: TECH_STAFF_ID,
    role: 'technician',
    first_name: 'Alice',
    last_name: 'Techie',
    auth_role: 'staff',
  }]);
}

function mockStoresStaff() {
  mockSql.mockResolvedValueOnce([{
    id: STORES_STAFF_ID,
    role: 'stores',
    first_name: 'Bob',
    last_name: 'Stores',
    auth_role: 'staff',
  }]);
}

function mockDriverStaff() {
  mockSql.mockResolvedValueOnce([{
    id: 'staff-driver-uuid',
    role: 'driver',
    first_name: 'Dave',
    last_name: 'Driver',
    auth_role: 'staff',
  }]);
}

function mockCreateReturn() {
  // 1. generate_return_number()
  mockSql.mockResolvedValueOnce([{ num: 'RET-202605-00001' }]);
  // 2. INSERT stock_returns RETURNING *
  mockSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    return_number: 'RET-202605-00001',
    status: 'pending',
    returned_by_id: TECH_STAFF_ID,
  }]);
  // 3. INSERT line 1
  mockSql.mockResolvedValueOnce([]);
  // 4. INSERT line 2
  mockSql.mockResolvedValueOnce([]);
  // 5. SELECT full return with lines
  mockSql.mockResolvedValueOnce([{
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
  mockSql.mockResolvedValueOnce([{ id: RETURN_ID, status: 'pending' }]);
  // 2. UPDATE stock_returns SET status='inspected'
  mockSql.mockResolvedValueOnce([]);
  // 3. UPDATE line 1 disposition
  mockSql.mockResolvedValueOnce([]);
  // 4. UPDATE line 2 disposition
  mockSql.mockResolvedValueOnce([]);
  // 5. SELECT full return
  mockSql.mockResolvedValueOnce([{
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

function mockAcceptReturn() {
  // neon sql calls (pre-transaction):
  // 1. GET return with lines (sql tag fn)
  mockSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    status: 'inspected',
    return_to_location_id: WAREHOUSE_LOCATION_ID,
    lines: [
      { id: LINE_1_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_1_ID, quantity: 1, disposition: 'restock' },
      { id: LINE_2_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_2_ID, quantity: 1, disposition: 'scrap' },
    ],
  }]);
  // 2. Final SELECT after commit
  mockSql.mockResolvedValueOnce([{
    id: RETURN_ID,
    return_number: 'RET-202605-00001',
    status: 'restocked',
  }]);

  // Client transaction: all queries succeed
  mockClientQuery.mockResolvedValue({ rows: [] });
}

// ── Test suites ────────────────────────────────────────────────────────────────

describe('Returns full flow integration', () => {
  beforeEach(() => {
    // mockSql.mockReset() clears both call history AND queued mockResolvedValueOnce items
    // for the SQL tag fn — prevents unconsumed queue items from a failing test bleeding
    // into the next test.
    // We use targeted .mockReset() on the fns we queue, NOT vi.resetAllMocks(), because
    // vi.resetAllMocks() also resets the Client constructor mockImplementation from the
    // vi.mock factory and that would cause the accept handler to fail.
    mockSql.mockReset();
    mockClientQuery.mockReset();
    mockClientConnect.mockReset();
    mockClientEnd.mockReset();
    // Re-apply defaults that the vi.mock factory normally provides
    mockClientConnect.mockResolvedValue(undefined);
    mockClientEnd.mockResolvedValue(undefined);
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
      // Targeted reset: clear call history + queued values without touching Client mock impl
      mockSql.mockReset();
      mockClientQuery.mockReset();
      mockClientConnect.mockReset();
      mockClientEnd.mockReset();
      mockClientConnect.mockResolvedValue(undefined);
      mockClientEnd.mockResolvedValue(undefined);

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
      const inspectCallStrings = mockSql.mock.calls.map((call) => {
        const parts = call[0] as TemplateStringsArray;
        return Array.isArray(parts) ? parts.join('') : String(call[0]);
      });
      expect(inspectCallStrings.some((s) => s.includes("status = 'inspected'"))).toBe(true);

      // ── Act 3: storeman accepts — mixed restock + scrap ───────────────────────
      // Targeted reset: clear call history + queued values without touching Client mock impl
      mockSql.mockReset();
      mockClientQuery.mockReset();
      mockClientConnect.mockReset();
      mockClientEnd.mockReset();
      mockClientConnect.mockResolvedValue(undefined);
      mockClientEnd.mockResolvedValue(undefined);

      mockStoresStaff();
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
      const clientCalls = mockClientQuery.mock.calls.map((c) => c[0] as string);
      expect(clientCalls[0]).toBe('BEGIN');
      expect(clientCalls.some((s) => s === 'COMMIT')).toBe(true);
      expect(clientCalls.some((s) => s === 'ROLLBACK')).toBe(false);

      // Restock branch: INSERT stock_quants and UPDATE stock_serials status='available'
      expect(clientCalls.some((s) => s.includes('stock_quants') && s.includes('INSERT'))).toBe(true);
      expect(clientCalls.some((s) =>
        s.includes('stock_serials') && s.includes("'available'")
      )).toBe(true);

      // Scrap branch: UPDATE stock_serials status='scrapped'
      expect(clientCalls.some((s) =>
        s.includes('stock_serials') && s.includes("'scrapped'")
      )).toBe(true);

      // stock_movements recorded for each line
      const movementInserts = clientCalls.filter((s) => s.includes('stock_movements'));
      expect(movementInserts.length).toBe(2);

      // stock_return_lines marked 'processed'
      const processedUpdates = clientCalls.filter(
        (s) => s.includes('stock_return_lines') && s.includes("'processed'")
      );
      expect(processedUpdates.length).toBe(2);

      // stock_returns marked 'restocked'
      expect(clientCalls.some(
        (s) => s.includes('stock_returns') && s.includes("'restocked'")
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
      mockSql.mockResolvedValueOnce([]);
      // generate_return_number
      mockSql.mockResolvedValueOnce([{ num: 'RET-202605-00001' }]);
      // INSERT stock_returns RETURNING *
      mockSql.mockResolvedValueOnce([{
        id: RETURN_ID,
        return_number: 'RET-202605-00001',
        status: 'pending',
        returned_by_id: TECH_STAFF_ID,
      }]);
      // INSERT single line
      mockSql.mockResolvedValueOnce([]);
      // SELECT full return
      mockSql.mockResolvedValueOnce([{
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

      // Second call — targeted reset to clear queued values without touching Client mock impl
      mockSql.mockReset();
      mockClientQuery.mockReset();
      mockClientConnect.mockReset();
      mockClientEnd.mockReset();
      mockClientConnect.mockResolvedValue(undefined);
      mockClientEnd.mockResolvedValue(undefined);

      mockTechStaff();
      // Idempotency check: existing row found
      mockSql.mockResolvedValueOnce([{
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
      expect(mockSql).toHaveBeenCalledTimes(2);
    });
  });

  // ── Authorisation ─────────────────────────────────────────────────────────────

  describe('Authorisation', () => {
    it('POST /returns rejects user with no staff link → 403', async () => {
      // Staff lookup returns empty
      mockSql.mockResolvedValueOnce([]);

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
      mockSql.mockResolvedValueOnce([{
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
      expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it('POST /returns/[id]/accept rejects technician → 403', async () => {
      mockSql.mockResolvedValueOnce([{
        id: TECH_STAFF_ID,
        role: 'technician',
        auth_role: 'staff',
      }]);

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
      expect(mockClientConnect).not.toHaveBeenCalled();
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
      const callStrings = mockSql.mock.calls.map((c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim());
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
      expect(mockSql).toHaveBeenCalledTimes(1);
    });
  });

  // ── Atomic accept rollback ────────────────────────────────────────────────────

  describe('Atomic accept', () => {
    it('rolls back all changes if one line update fails', async () => {
      mockStoresStaff();

      // GET return with 2 lines
      mockSql.mockResolvedValueOnce([{
        id: RETURN_ID,
        status: 'inspected',
        return_to_location_id: WAREHOUSE_LOCATION_ID,
        lines: [
          { id: LINE_1_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_1_ID, quantity: 1, disposition: 'restock' },
          { id: LINE_2_ID, stock_item_id: 'item-ont-uuid', serial_id: SERIAL_2_ID, quantity: 1, disposition: 'scrap' },
        ],
      }]);

      // Client: BEGIN succeeds, then INSERT stock_quants for line 1 throws (simulates constraint violation)
      mockClientQuery
        .mockResolvedValueOnce({ rows: [] })              // BEGIN
        .mockRejectedValueOnce(new Error('constraint violation: stock_quants_pkey')); // INSERT stock_quants (line 1)

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
      const clientCalls = mockClientQuery.mock.calls.map((c) => c[0] as string);
      expect(clientCalls.some((s) => s === 'ROLLBACK')).toBe(true);

      // COMMIT must NOT have been called
      expect(clientCalls.some((s) => s === 'COMMIT')).toBe(false);

      // client.end() must be called (finally block always runs)
      expect(mockClientEnd).toHaveBeenCalled();

      // No stock_returns status='restocked' update
      expect(clientCalls.some(
        (s) => typeof s === 'string' && s.includes('stock_returns') && s.includes("'restocked'")
      )).toBe(false);

      // No stock_return_lines status='processed' update (never reached after first line failed)
      expect(clientCalls.some(
        (s) => typeof s === 'string' && s.includes('stock_return_lines') && s.includes("'processed'")
      )).toBe(false);
    });
  });
});
