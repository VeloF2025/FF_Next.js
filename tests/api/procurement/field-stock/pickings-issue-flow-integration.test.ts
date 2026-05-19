/**
 * Integration tests for POST /api/procurement/field-stock/pickings
 * Task 2.9 — Orchestrator-driven body shape coverage.
 *
 * Focus: the exact request body the IssueOrchestrator / submitIssue() sends,
 * including the `notes` and `serialIds` fields on each line. Cases that already
 * appear in pickings-pending-tech-cap.test.ts (edge-cap values, suspended-tech,
 * absent-technicianId) are NOT duplicated here.
 *
 * Body shape under test (mirrors api.ts submitIssue):
 *   {
 *     pickingType: 'issue',
 *     technicianId:          '<staff uuid>',
 *     sourceLocationId:      '<location uuid>',
 *     destinationLocationId: '<location uuid>',
 *     lines: [
 *       {
 *         stockItemId:      '<item uuid>',
 *         plannedQuantity:  2,
 *         serialIds:        ['serial-1', 'serial-2'],
 *         notes:            'Issued via PWA',
 *       },
 *     ],
 *   }
 *
 * Known quirk: the handler calls res.status(201) then apiResponse.success()
 * which internally calls res.status(200). Because our mock re-assigns _status
 * on every .status() call, the final observable value is 200, not 201.
 * Tests assert 200 here — DO NOT change them to 201 to match "correct" HTTP
 * semantics; the handler has this quirk on purpose (apiResponse.success
 * overrides it) and correcting it is a separate task.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

// The handler imports neon() at module-level and calls it immediately, so we
// must mock @neondatabase/serverless before the handler is imported.
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

/**
 * The exact body shape the orchestrator sends (api.ts submitIssue).
 * Callers may override individual keys.
 */
function orchestratorBody(overrides: Record<string, unknown> = {}) {
  return {
    pickingType: 'issue',
    technicianId: 'tech-staff-uuid',
    sourceLocationId: 'loc-warehouse-uuid',
    destinationLocationId: 'loc-tech-uuid',
    lines: [
      {
        stockItemId: 'item-ont-uuid',
        plannedQuantity: 2,
        serialIds: ['serial-1', 'serial-2'],
        notes: 'Issued via PWA',
      },
    ],
    ...overrides,
  };
}

/**
 * Set up mockSql to simulate a fully successful picking create for a tech
 * with the given `accountStatus`. The `standardCost` value is only used when
 * `accountStatus === 'pending'` (handler skips the price lookup otherwise).
 *
 * SQL call order for active / suspended techs (no price check):
 *   1. staff lookup  2. COUNT  3. INSERT picking  4. INSERT line  5. refetch
 *
 * SQL call order for pending techs (price check added after staff lookup):
 *   1. staff lookup  2. stock_items  3. COUNT  4. INSERT picking
 *   5. INSERT line  6. refetch
 */
function mockSuccessCreate(accountStatus: 'active' | 'suspended' | 'pending', standardCost = 1000) {
  // 1. Staff lookup
  mockSql.mockResolvedValueOnce([{ account_status: accountStatus }]);

  if (accountStatus === 'pending') {
    // 2. stock_items price lookup (one per line — we have 1 line)
    mockSql.mockResolvedValueOnce([{ standard_cost: standardCost }]);
  }

  // COUNT
  mockSql.mockResolvedValueOnce([{ count: '99' }]);
  // INSERT picking — returns the new picking row
  mockSql.mockResolvedValueOnce([{
    id: 'picking-uuid-new',
    picking_number: 'PCK-000100',
    status: 'draft',
  }]);
  // INSERT line (one line in our test body)
  mockSql.mockResolvedValueOnce([]);
  // Refetch with joins
  mockSql.mockResolvedValueOnce([{
    id: 'picking-uuid-new',
    picking_number: 'PCK-000100',
    status: 'draft',
    lines: [
      {
        id: 'line-uuid-1',
        stock_item_id: 'item-ont-uuid',
        planned_quantity: 2,
        serial_ids: ['serial-1', 'serial-2'],
        notes: 'Issued via PWA',
        status: 'pending',
      },
    ],
  }]);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('POST /api/procurement/field-stock/pickings — orchestrator body shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Case 1: active tech, single line, 2 serialIds, notes present → 200
  it('active tech, single line with 2 serialIds and notes → 200, picking row returned', async () => {
    mockSuccessCreate('active');

    const req = makeReq({ body: orchestratorBody() });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    // KNOWN QUIRK: apiResponse.success() overrides res.status(201) with 200.
    expect(res._status).toBe(200);
    const body = res._json as { success: boolean; data: { id: string; picking_number: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('picking-uuid-new');
    expect(body.data.picking_number).toBe('PCK-000100');
  });

  // Case 2: pending tech, 2 serials @ R2,000 each = R4,000 (under R5,000 cap) → 200
  it('pending tech, 2 serials at R2000 each (total R4000, under cap) → 200, picking created', async () => {
    // plannedQuantity=2, standard_cost=2000 → total = 4000 (under 5000 cap)
    mockSuccessCreate('pending', 2000);

    const req = makeReq({
      body: orchestratorBody({
        lines: [
          {
            stockItemId: 'item-ont-uuid',
            plannedQuantity: 2,
            serialIds: ['serial-1', 'serial-2'],
            notes: 'Issued via PWA',
          },
        ],
      }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(true);

    // Confirm the price-lookup SQL was called (pending tech path)
    const allSql = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').toLowerCase(),
    );
    expect(allSql.some((s) => s.includes('standard_cost'))).toBe(true);
  });

  // Case 3: pending tech, 2 serials @ R3,000 each = R6,000 (over R5,000 cap) → 400
  it('pending tech, 2 serials at R3000 each (total R6000, over cap) → 400 PENDING_TECH_VALUE_CAP_EXCEEDED', async () => {
    // Staff lookup
    mockSql.mockResolvedValueOnce([{ account_status: 'pending' }]);
    // Price lookup: R3000 per unit; plannedQuantity=2 → total = R6000
    mockSql.mockResolvedValueOnce([{ standard_cost: 3000 }]);

    const req = makeReq({
      body: orchestratorBody({
        lines: [
          {
            stockItemId: 'item-ont-uuid',
            plannedQuantity: 2,
            serialIds: ['serial-1', 'serial-2'],
            notes: 'Issued via PWA',
          },
        ],
      }),
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(400);
    const body = res._json as {
      success: boolean;
      error: {
        code: string;
        details: { code: string; totalZar: number; capZar: number };
      };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.details.code).toBe('PENDING_TECH_VALUE_CAP_EXCEEDED');
    expect(body.error.details.totalZar).toBe(6000);
    expect(body.error.details.capZar).toBe(5000);

    // No INSERT must have been called — cap breach blocks before any write.
    const callTemplates = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim(),
    );
    expect(callTemplates.some((t) => t.startsWith('INSERT'))).toBe(false);
  });

  // Case 4: pending tech, stock item with NULL standard_cost → 400 PENDING_TECH_VALUE_UNKNOWN
  it('pending tech, NULL standard_cost on item → 400 PENDING_TECH_VALUE_UNKNOWN', async () => {
    mockSql.mockResolvedValueOnce([{ account_status: 'pending' }]);
    mockSql.mockResolvedValueOnce([{ standard_cost: null }]);

    const req = makeReq({
      body: orchestratorBody({
        lines: [
          {
            stockItemId: 'item-unpriced-uuid',
            plannedQuantity: 2,
            serialIds: ['serial-1', 'serial-2'],
            notes: 'Issued via PWA',
          },
        ],
      }),
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

    // No INSERT on unknown-price rejection.
    const callTemplates = mockSql.mock.calls.map(
      (c) => String((c[0] as TemplateStringsArray)?.[0] ?? '').trim(),
    );
    expect(callTemplates.some((t) => t.startsWith('INSERT'))).toBe(false);
  });

  // Case 5: missing `lines` field in body → 422 VALIDATION_ERROR (existing behaviour)
  it('missing lines field → 422 VALIDATION_ERROR, no SQL called', async () => {
    const req = makeReq({
      body: {
        pickingType: 'issue',
        technicianId: 'tech-staff-uuid',
        sourceLocationId: 'loc-warehouse-uuid',
        destinationLocationId: 'loc-tech-uuid',
        // `lines` intentionally omitted to trigger existing validation
      },
    });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);
    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    // Validation must short-circuit before any DB access.
    expect(mockSql).not.toHaveBeenCalled();
  });
});
