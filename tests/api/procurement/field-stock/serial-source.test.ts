/**
 * Integration tests for GET /api/procurement/field-stock/serial-source
 * Task B.5 — serial-source endpoint (Phase 3 return wizard mixed-source guard).
 *
 * Mock pattern mirrors my-serials.test.ts (Task B.4):
 *   - @neondatabase/serverless hoisted + mocked before handler import
 *   - @/lib/auth withAuth passthrough mock
 *   - @/lib/logger silenced
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));

// The handler calls neon() at module-level, so we must mock before import.
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

import handler from '../../../../pages/api/procurement/field-stock/serial-source';

// ── Helpers ───────────────────────────────────────────────────────────────────

type PartialReq = Partial<NextApiRequest> & { user?: { id: string; role: string } };

function makeReq(overrides: Partial<PartialReq> = {}): PartialReq {
  return {
    method: 'GET',
    body: {},
    query: {},
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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/procurement/field-stock/serial-source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns source warehouse from latest issue picking', async () => {
    const sourceLocationId = 'loc-main-warehouse-uuid';
    const pickingId = 'picking-uuid-001';

    mockSql.mockResolvedValueOnce([
      {
        source_location_id: sourceLocationId,
        source_location_name: 'Main Warehouse',
        picking_id: pickingId,
      },
    ]);

    const req = makeReq({ query: { serialNumber: 'SN-ABC-001' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(200);

    const body = res._json as {
      success: boolean;
      data: {
        sourceLocationId: string;
        sourceLocationName: string;
        originalPickingId: string;
      };
    };

    expect(body.success).toBe(true);
    expect(body.data.sourceLocationId).toBe(sourceLocationId);
    expect(body.data.sourceLocationName).toBe('Main Warehouse');
    expect(body.data.originalPickingId).toBe(pickingId);

    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when serial has no issue picking history', async () => {
    mockSql.mockResolvedValueOnce([]);

    const req = makeReq({ query: { serialNumber: 'SN-NOT-FOUND' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(404);

    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('returns 422 when serialNumber query param missing', async () => {
    const req = makeReq({ query: {} });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);

    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    // No SQL calls — validation guard fires first
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns 422 when serialNumber is empty string after trim', async () => {
    const req = makeReq({ query: { serialNumber: '   ' } });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(422);

    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');

    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns 405 on POST', async () => {
    const req = makeReq({ method: 'POST' });
    const res = makeRes();

    await handler(req as NextApiRequest, res as NextApiResponse);

    expect(res._status).toBe(405);

    const body = res._json as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED');

    // No SQL calls — method guard fires first
    expect(mockSql).not.toHaveBeenCalled();
  });
});
