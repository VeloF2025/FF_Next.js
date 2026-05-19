/**
 * Tests for server-side R5,000 pending-technician stock-value cap.
 * Task 2.6 — POST /api/procurement/field-stock/pickings
 *
 * Body shape: { technicianId, sourceLocationId, destinationLocationId, lines: PickingLine[] }
 * PickingLine: { stockItemId, plannedQuantity, serialIds?, lotNumber?, notes? }
 *
 * Divergence from plan: plan used `body.serialNumbers` + `standard_price`;
 * actual handler uses `lines[]` per-line and schema column is `standard_cost`.
 *
 * Suspended-tech (Case 5): No suspend gate at this endpoint — /my/* handles it.
 *   account_status='suspended' != 'pending' → cap skipped → picking succeeds here.
 * Missing-tech (Case 6): technicianId optional (nullable schema). Absent → guard
 *   skipped. Present-but-not-found → account_status undefined → cap not enforced.
 *   Phase 4 adds explicit tech-existence validation.
 * Empty-lines (Case 8): Rejected by existing validation (422) before cap check.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

// The handler imports neon() and calls it immediately at module level, so we mock
// the entire @neondatabase/serverless module and return mockSql as the tagged-
// template sql function.
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

// ── Import handler after mocks ─────────────────────────────────────────────────

import handler from '../../../../pages/api/procurement/field-stock/pickings/index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'POST',
    body: {},
    query: {},
    user: { id: 'user-stores-uuid', role: 'storeman' },
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

/** Minimal valid POST body that passes existing validation */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    pickingType: 'outgoing',
    sourceLocationId: 'loc-warehouse-uuid',
    destinationLocationId: 'loc-tech-uuid',
    technicianId: 'tech-staff-uuid',
    technicianName: 'John Doe',
    lines: [{ stockItemId: 'item-uuid-1', plannedQuantity: 2 }],
    ...overrides,
  };
}

/**
 * SQL call sequence for a successful create after cap check passes:
 *   1. staff lookup → 2. stock_items (×lineCount) → 3. COUNT → 4. INSERT picking
 *   → 5. INSERT lines (×lineCount) → 6. refetch
 */
function mockSuccessfulCreate(
  accountStatus: string,
  standardCost: number,
  lineCount = 1,
) {
  // 1. Staff lookup
  mockSql.mockResolvedValueOnce([{ account_status: accountStatus }]);
  // 2. stock_items lookup — one call per line
  for (let i = 0; i < lineCount; i++) {
    mockSql.mockResolvedValueOnce([{ standard_cost: standardCost }]);
  }
  // 3. COUNT
  mockSql.mockResolvedValueOnce([{ count: '42' }]);
  mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-1', picking_number: 'PCK-000043', status: 'draft' }]);
  for (let i = 0; i < lineCount; i++) mockSql.mockResolvedValueOnce([]);
  mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-1', picking_number: 'PCK-000043', lines: [] }]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/procurement/field-stock/pickings — pending-tech cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case 1: Pending tech, total under cap → 200 (picking created)
  // Note: handler has res.status(201) then apiResponse.success(res,data) which re-issues 200.
  it('pending tech, total under R5000 → 200, INSERT proceeds', async () => {
    mockSuccessfulCreate('pending', 2000, 1);
    const req = makeReq({ body: validBody({ lines: [{ stockItemId: 'item-uuid-1', plannedQuantity: 1 }] }) });
    const res = makeRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res._status).toBe(200);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);
  });

  // Case 2: Pending tech, exactly at cap (5000.00) → 200, not blocked (strictly > semantics)
  it('pending tech, total exactly R5000.00 → 200, not blocked (strictly > semantics)', async () => {
    mockSuccessfulCreate('pending', 2500, 1);
    const req = makeReq({
      body: validBody({ lines: [{ stockItemId: 'item-uuid-1', plannedQuantity: 2 }] }),
    });
    const res = makeRes();
    await handler(req as NextApiRequest, res as NextApiResponse);
    expect(res._status).toBe(200);
  });

  // Case 3: Pending tech, over cap (5000.01) → 400 with structured error code
  it('pending tech, total R5000.01 → 400 PENDING_TECH_VALUE_CAP_EXCEEDED with totalZar and capZar', async () => {
    mockSql.mockResolvedValueOnce([{ account_status: 'pending' }]);
    mockSql.mockResolvedValueOnce([{ standard_cost: 5000.01 }]);

    const req = makeReq({
      body: validBody({ lines: [{ stockItemId: 'item-uuid-1', plannedQuantity: 1 }] }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    const body = res._json as {
      success: boolean;
      error: { code: string; message: string; details: { code: string; totalZar: number; capZar: number } };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details.code).toBe('PENDING_TECH_VALUE_CAP_EXCEEDED');
    expect(body.error.details.totalZar).toBe(5000.01);
    expect(body.error.details.capZar).toBe(5000);
    // No INSERT should have been called
    const callTemplates = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim(),
    );
    expect(callTemplates.some((t) => t.startsWith('INSERT'))).toBe(false);
  });

  // Case 4: Active tech, value far above cap → 201, cap not enforced
  it('active tech, value R50000 (far above cap) → 201, cap not enforced', async () => {
    mockSql.mockResolvedValueOnce([{ account_status: 'active' }]);        // staff
    mockSql.mockResolvedValueOnce([{ count: '1' }]);
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-2', picking_number: 'PCK-000002', status: 'draft' }]);
    mockSql.mockResolvedValueOnce([]);  // line insert
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-2', picking_number: 'PCK-000002', lines: [] }]);

    const req = makeReq({
      body: validBody({
        lines: [{ stockItemId: 'item-expensive-uuid', plannedQuantity: 10 }],
      }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Pre-existing handler quirk: apiResponse.success overrides res.status(201) with 200.
    expect(res._status).toBe(200);
    // Confirm no stock_items price lookup happened (active tech bypasses price check)
    const allSqlStrings = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').toLowerCase(),
    );
    expect(allSqlStrings.some((s) => s.includes('standard_cost'))).toBe(false);
  });

  // Case 5: Suspended tech → cap not enforced (picking succeeds at this endpoint).
  // Suspend gate lives at /my/* session level; this endpoint is scope-free of it.
  it('suspended tech, value R50000 → 201, no cap enforced (suspend gate is at /my/* level)', async () => {
    mockSql.mockResolvedValueOnce([{ account_status: 'suspended' }]);     // staff
    mockSql.mockResolvedValueOnce([{ count: '10' }]);
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-3', picking_number: 'PCK-000011', status: 'draft' }]);
    mockSql.mockResolvedValueOnce([]);  // line insert
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-3', picking_number: 'PCK-000011', lines: [] }]);

    const req = makeReq({
      body: validBody({ lines: [{ stockItemId: 'item-uuid-1', plannedQuantity: 5 }] }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Pre-existing handler quirk: apiResponse.success overrides res.status(201) with 200.
    expect(res._status).toBe(200);
  });

  // Case 6: technicianId absent → guard short-circuits on `if (technicianId)`.
  it('no technicianId in body → cap guard skipped, picking proceeds (404 not returned)', async () => {
    // No staff lookup — straight to COUNT
    mockSql.mockResolvedValueOnce([{ count: '5' }]);
    mockSql.mockResolvedValueOnce([{
      id: 'picking-uuid-4', picking_number: 'PCK-000006', status: 'draft',
      source_location_id: 'loc-warehouse-uuid', destination_location_id: 'loc-tech-uuid',
    }]);
    mockSql.mockResolvedValueOnce([]);  // line insert
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-4', lines: [] }]);

    const req = makeReq({
      body: validBody({ technicianId: undefined, technicianName: undefined }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // Pre-existing handler quirk: apiResponse.success overrides res.status(201) with 200.
    expect(res._status).toBe(200);
  });

  // Case 7: Pending tech + stock item with null standard_cost → 400 PENDING_TECH_VALUE_UNKNOWN
  it('pending tech + stock item has null standard_cost → 400 PENDING_TECH_VALUE_UNKNOWN', async () => {
    mockSql.mockResolvedValueOnce([{ account_status: 'pending' }]);       // staff
    mockSql.mockResolvedValueOnce([{ standard_cost: null }]);             // stock_items — null cost

    const req = makeReq({
      body: validBody({ lines: [{ stockItemId: 'item-unpriced-uuid', plannedQuantity: 1 }] }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    const body = res._json as {
      success: boolean;
      error: { code: string; details: { code: string; stockItemId: string } };
    };
    expect(body.success).toBe(false);
    expect(body.error.details.code).toBe('PENDING_TECH_VALUE_UNKNOWN');
    expect(body.error.details.stockItemId).toBe('item-unpriced-uuid');
    // No INSERT
    const callTemplates = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim(),
    );
    expect(callTemplates.some((t) => t.startsWith('INSERT'))).toBe(false);
  });

  // Case 8: Empty lines array → 422 VALIDATION_ERROR (existing handler, unchanged).
  it('empty lines array → 422 validation error (existing behaviour preserved)', async () => {
    const req = makeReq({
      body: validBody({ lines: [] }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // No SQL calls at all — rejected before any DB access
    expect(mockSql).not.toHaveBeenCalled();
  });

  // ── H5 new cases (blind review 2026-05-19) ────────────────────────────────

  // Case H5-1: destination=FIELD_DEFAULT, technicianId omitted → 400
  it('H5: destinationLocationId=FIELD_DEFAULT + technicianId omitted → 400 FIELD_DEFAULT_REQUIRES_TECHNICIAN', async () => {
    const FIELD_DEFAULT_LOCATION_ID = '00000000-0000-0000-0000-000000000001';

    const req = makeReq({
      body: {
        ...validBody({ technicianId: undefined, technicianName: undefined }),
        destinationLocationId: FIELD_DEFAULT_LOCATION_ID,
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    const body = res._json as {
      success: boolean;
      error: { code: string; details: { code: string } };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details.code).toBe('FIELD_DEFAULT_REQUIRES_TECHNICIAN');
    // No DB access before validation rejects
    expect(mockSql).not.toHaveBeenCalled();
  });

  // Case H5-2: destination=FIELD_DEFAULT, technicianId present → allowed through (no 400)
  it('H5: destinationLocationId=FIELD_DEFAULT + technicianId present → guard passes (active tech succeeds)', async () => {
    const FIELD_DEFAULT_LOCATION_ID = '00000000-0000-0000-0000-000000000001';

    // Active tech — no price check; no serials in line so no H7 check either.
    mockSql.mockResolvedValueOnce([{ account_status: 'active' }]);  // staff
    mockSql.mockResolvedValueOnce([{ count: '20' }]);               // COUNT
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-5', picking_number: 'PCK-000021', status: 'draft' }]);
    mockSql.mockResolvedValueOnce([]);                              // line insert
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-5', lines: [] }]);

    const req = makeReq({
      body: {
        ...validBody(),
        destinationLocationId: FIELD_DEFAULT_LOCATION_ID,
        // technicianId is set via validBody() default: 'tech-staff-uuid'
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);
  });

  // ── H7 new cases (blind review 2026-05-19) ────────────────────────────────

  // Case H7-1: active tech, 1 valid + 1 unavailable serial → 400 SERIAL_NOT_AVAILABLE
  it('H7: active tech, mixed valid/unavailable serials → 400 with unavailable serial listed', async () => {
    // Active tech — no price check needed; go straight to H7 serial check
    mockSql.mockResolvedValueOnce([{ account_status: 'active' }]);    // staff
    // H7: serial-valid → row returned (available)
    mockSql.mockResolvedValueOnce([{ id: 'serial-valid' }]);
    // H7: serial-taken → empty (not available)
    mockSql.mockResolvedValueOnce([]);

    const req = makeReq({
      body: validBody({
        lines: [
          {
            stockItemId: 'item-uuid-1',
            plannedQuantity: 2,
            serialIds: ['serial-valid', 'serial-taken'],
          },
        ],
      }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    const body = res._json as {
      success: boolean;
      error: { code: string; details: { code: string; unavailableSerials: string[] } };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details.code).toBe('SERIAL_NOT_AVAILABLE');
    expect(body.error.details.unavailableSerials).toContain('serial-taken');
    expect(body.error.details.unavailableSerials).not.toContain('serial-valid');
    // No INSERT after serial rejection
    const callTemplates = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim(),
    );
    expect(callTemplates.some((t) => t.startsWith('INSERT'))).toBe(false);
  });

  // Case H7-2: active tech, all serials available → proceeds to INSERT (200)
  it('H7: active tech, all serials available → 200, INSERT proceeds', async () => {
    // Active tech — no price check; 2 serials both available
    mockSql.mockResolvedValueOnce([{ account_status: 'active' }]);    // staff
    mockSql.mockResolvedValueOnce([{ id: 'serial-a' }]);              // H7 serial-a available
    mockSql.mockResolvedValueOnce([{ id: 'serial-b' }]);              // H7 serial-b available
    mockSql.mockResolvedValueOnce([{ count: '15' }]);                 // COUNT
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-6', picking_number: 'PCK-000016', status: 'draft' }]);
    mockSql.mockResolvedValueOnce([]);                                // line insert
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-6', lines: [] }]);

    const req = makeReq({
      body: validBody({
        lines: [
          { stockItemId: 'item-uuid-1', plannedQuantity: 2, serialIds: ['serial-a', 'serial-b'] },
        ],
      }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);
  });

  // Case H7-3: lines without serialIds → H7 check skipped, no extra SQL calls
  it('H7: lines without serialIds → serial check skipped entirely', async () => {
    // Active tech, line has no serialIds — re-uses the simple create path
    mockSql.mockResolvedValueOnce([{ account_status: 'active' }]);    // staff
    // H7: NO serial check SQL — line has no serialIds
    mockSql.mockResolvedValueOnce([{ count: '3' }]);                  // COUNT
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-7', picking_number: 'PCK-000004', status: 'draft' }]);
    mockSql.mockResolvedValueOnce([]);                                // line insert
    mockSql.mockResolvedValueOnce([{ id: 'picking-uuid-7', lines: [] }]);

    const req = makeReq({
      body: validBody({ lines: [{ stockItemId: 'item-uuid-1', plannedQuantity: 3 }] }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);
    // Confirm no stock_serials SELECT was issued
    const allSql = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').toLowerCase(),
    );
    expect(allSql.some((s) => s.includes('stock_serials'))).toBe(false);
  });
});
