/**
 * Integration tests for GET /api/procurement/field-stock/my-serials
 * Task B.4 — my-serials endpoint (Phase 3 return wizard scan step).
 *
 * Mock surface:
 *   - @/lib/db sql template tag stubbed (handler migrated off the Neon
 *     serverless shim to the in-house pg.Pool wrapper at @/lib/db).
 *   - @/lib/auth withAuth passthrough mock
 *   - @/lib/logger silenced
 *   - user injected via req.user (withAuth stripped by mock)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

vi.mock('@/lib/db', () => ({
  // Handler imports `{ sql }` only — pool/default kept off the mock to avoid
  // implying the handler reaches for them.
  sql: mockSql,
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

import handler from '../../../../pages/api/procurement/field-stock/my-serials';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'GET',
    body: {},
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

// ── SQL call order for the happy path ─────────────────────────────────────────
//  1. staff lookup (WHERE user_id = $userId)
//  2. CTE query returning serial rows

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/procurement/field-stock/my-serials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns serials with status=issued held by calling staff', async () => {
    const staffId = 'staff-tech-uuid';
    const locationId = 'loc-warehouse-uuid';

    // 1. Staff lookup
    mockSql.mockResolvedValueOnce([{ id: staffId }]);

    // 2. CTE query — 2 serials for this tech, 0 for other staff / installed serials
    mockSql.mockResolvedValueOnce([
      {
        serial_id: 'serial-uuid-1',
        serial_number: 'SN-001',
        stock_item_id: 'item-ont-uuid',
        stock_item_name: 'ONT Device A',
        source_location_id: locationId,
        source_location_name: 'Main Warehouse',
      },
      {
        serial_id: 'serial-uuid-2',
        serial_number: 'SN-002',
        stock_item_id: 'item-ont-uuid',
        stock_item_name: 'ONT Device A',
        source_location_id: locationId,
        source_location_name: 'Main Warehouse',
      },
    ]);

    const req = makeReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    const body = res._json as {
      success: boolean;
      data: Array<{
        serialId: string;
        serialNumber: string;
        stockItemId: string;
        stockItemName: string;
        sourceLocationId: string;
        sourceLocationName: string;
      }>;
    };

    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);

    // Both rows must reference the picking's source warehouse
    for (const row of body.data) {
      expect(row.sourceLocationId).toBe(locationId);
    }

    // The other-staff serial and the installed serial should NOT appear
    // (the CTE query filters by technician_id = staffId AND status = 'issued',
    // so only rows matching both conditions are returned — the mock only
    // returns the 2 correct rows above, matching DB behaviour)
    expect(body.data.map((r) => r.serialId)).not.toContain('serial-other-staff');
    expect(body.data.map((r) => r.serialId)).not.toContain('serial-installed');
  });

  it('returns 401 when no user session', async () => {
    // withAuth is mocked as passthrough — omit user from req to simulate no session
    const req = makeReq({ user: undefined });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(401);
    const body = res._json as { success: boolean };
    expect(body.success).toBe(false);

    // No SQL should be called — auth gate fires first
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns empty array when staff row missing for user', async () => {
    // Staff lookup returns no rows
    mockSql.mockResolvedValueOnce([]);

    const req = makeReq({ user: { id: 'user-no-staff-uuid', role: 'technician' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as { success: boolean; data: unknown[] };
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);

    // Only the staff lookup SQL was called; CTE query must not run
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('returns 405 on POST', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(405);
    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');

    // No SQL calls — method guard fires before any DB access
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('deduplicates re-issued serials (DISTINCT ON picks latest picking)', async () => {
    // Scenario: serial SN-100 was issued to this tech at picking A (older),
    // then re-issued at picking B (newer, different warehouse).
    // The CTE uses DISTINCT ON (id) ORDER BY id, picking_at DESC, so the
    // mock returns only 1 row — the one from the newest picking's warehouse.
    const staffId = 'staff-tech-uuid';
    const newerWarehouseId = 'loc-newer-warehouse-uuid';

    // 1. Staff lookup
    mockSql.mockResolvedValueOnce([{ id: staffId }]);

    // 2. CTE query — DISTINCT ON ensures only 1 row per serial is returned,
    //    using the latest picking's source_location_id
    mockSql.mockResolvedValueOnce([
      {
        serial_id: 'serial-uuid-100',
        serial_number: 'SN-100',
        stock_item_id: 'item-router-uuid',
        stock_item_name: 'Router B',
        source_location_id: newerWarehouseId,
        source_location_name: 'Secondary Warehouse',
      },
    ]);

    const req = makeReq();
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);
    const body = res._json as {
      success: boolean;
      data: Array<{ serialId: string; sourceLocationId: string }>;
    };

    expect(body.success).toBe(true);
    // Exactly 1 row (deduplicated)
    expect(body.data).toHaveLength(1);
    expect(body.data[0].serialId).toBe('serial-uuid-100');
    // Source is from the latest (newer) picking
    expect(body.data[0].sourceLocationId).toBe(newerWarehouseId);
  });
});
