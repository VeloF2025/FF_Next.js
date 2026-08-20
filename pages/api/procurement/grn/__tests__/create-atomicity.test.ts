/**
 * Atomicity tests for POST /api/procurement/grn.
 *
 * The handler used to insert the GRN header and then each line as separate
 * statements. A line that failed left an item-less header behind — that is how
 * GRN26-00326 and GRN26-00327 appeared in production on 2026-08-20, when a
 * broken trigger made every line insert throw.
 *
 * These pin the structural guarantee: header and lines are issued on ONE
 * transaction client, and a failing line propagates rather than being
 * half-committed. The real handler runs; only the DB boundary is faked.
 *
 * The end-to-end proof (a real FK violation against Postgres leaving zero rows,
 * and the same test failing against a non-transactional mutant) was run locally
 * against the shared database; it is not committed because CI has no such DB.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';
import type { NextApiRequest, NextApiResponse } from 'next';

const mocks = vi.hoisted(() => ({
  neonTag: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@neondatabase/serverless', () => ({ neon: () => mocks.neonTag }));
vi.mock('@/lib/db-pool', () => ({ transaction: mocks.transaction }));
vi.mock('@/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/db-logger', () => ({ logCreate: vi.fn() }));
vi.mock('@/services/procurement/auditService', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h, AuthenticatedRequest: class {} }));

import handler from '../index';

const BODY = {
  purchaseOrderId: 'po-1',
  supplierId: 18,
  warehouseId: 'wh-1',
  deliveryNoteNumber: 'DEL030718',
  items: [
    { poItemId: 'poi-1', itemCode: 'ITEM-1', quantityReceived: 5000, quantityRejected: 0, uom: 'unit' },
    { poItemId: 'poi-2', itemCode: 'ITEM-2', quantityReceived: 0, quantityRejected: 0, uom: 'unit' },
    { poItemId: 'poi-3', itemCode: 'ITEM-3', quantityReceived: 0, quantityRejected: 0, uom: 'unit' },
  ],
};

function invoke(body: unknown = BODY) {
  const { req, res } = createMocks<NextApiRequest, NextApiResponse>({ method: 'POST', body });
  (req as unknown as { user: unknown }).user = { id: 'u-1', role: 'admin', email: 'a@x.co', name: 'A' };
  return (handler as unknown as (r: NextApiRequest, s: NextApiResponse) => Promise<void>)(req, res)
    .then(() => res);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/procurement/grn — atomicity', () => {
  it('issues the header and every line on one transaction client', async () => {
    const seen: { text: string; client: object }[] = [];
    mocks.transaction.mockImplementation(async (cb: (txn: unknown) => Promise<unknown>) => {
      const txn = {
        query: async (text: string) => { seen.push({ text, client: txn }); return []; },
        queryOne: async (text: string) => {
          seen.push({ text, client: txn });
          return { id: 'grn-1', grn_number: 'GRN26-00400', supplier_id: 18 };
        },
      };
      return cb(txn);
    });

    const res = await invoke();

    expect(res._getStatusCode()).toBe(201);
    // 1 header + 3 lines, all on the same txn object — nothing escaped to a
    // second connection outside the transaction.
    expect(seen).toHaveLength(4);
    expect(seen[0]!.text).toContain('INSERT INTO goods_receipt_notes');
    expect(seen.slice(1).every((q) => q.text.includes('INSERT INTO goods_receipt_items'))).toBe(true);
    expect(new Set(seen.map((q) => q.client)).size).toBe(1);
    // The header must never be written through the non-transactional neon tag.
    expect(mocks.neonTag).not.toHaveBeenCalled();
  });

  it('surfaces a failing line as an error instead of returning a half-written GRN', async () => {
    mocks.transaction.mockImplementation(async (cb: (txn: unknown) => Promise<unknown>) => {
      let lines = 0;
      const txn = {
        query: async () => {
          lines += 1;
          if (lines === 2) throw new Error('insert or update violates foreign key constraint');
          return [];
        },
        queryOne: async () => ({ id: 'grn-1', grn_number: 'GRN26-00400', supplier_id: 18 }),
      };
      // Mirrors the real helper: the callback's rejection propagates after ROLLBACK.
      return cb(txn);
    });

    const res = await invoke();

    expect(res._getStatusCode()).toBeGreaterThanOrEqual(500);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty item list before opening a transaction', async () => {
    const res = await invoke({ ...BODY, items: [] });

    expect(res._getStatusCode()).toBe(422);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
