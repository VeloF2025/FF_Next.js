import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

interface RecordedQuery { text: string; params: unknown[] }
const txnQueries: RecordedQuery[] = [];

// Configurable per-test canned rows for the in-transaction PO-line lookup.
const cfg: { grnStatus: string; poLine: Record<string, unknown> | null } = {
  grnStatus: 'draft',
  poLine: null,
};

vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      txnQueries.push({ text, params });
      if (/goods_receipt_notes[\s\S]*FOR UPDATE/i.test(text)) return [{ status: cfg.grnStatus }];
      if (/purchase_order_items[\s\S]*FOR UPDATE/i.test(text)) return cfg.poLine ? [cfg.poLine] : [];
      if (/RETURNING/i.test(text)) return [{ id: 'mv-1' }];
      return [];
    }),
    queryOne: vi.fn(async () => null),
    client: {},
  })),
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []), unsafe: (s: string) => s }),
}));
vi.mock('@/lib/auth', () => ({ withAuth: (h: unknown) => h }));
vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/services/procurement/auditService', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/modules/accounting/services/glIntegrationHooks', () => ({ postGRNToGL: vi.fn() }));

import * as dbPool from '@/lib/db-pool';
import handler from '../../../pages/api/procurement/grn-confirm';

function makeReq(body: Record<string, unknown>): NextApiRequest {
  return { method: 'POST', body, query: {}, headers: {}, user: { id: 'user-test' } } as unknown as NextApiRequest;
}

function makeRes() {
  const res = {} as NextApiResponse & { _status?: number; _json?: unknown };
  res.status = vi.fn((c: number) => { (res as { _status?: number })._status = c; return res; }) as never;
  res.json = vi.fn((b: unknown) => { (res as { _json?: unknown })._json = b; return res; }) as never;
  res.setHeader = vi.fn(() => res) as never;
  return res;
}

const joined = () => txnQueries.map(q => q.text).join('\n');

describe('POST /api/procurement/grn-confirm', () => {
  beforeEach(() => { txnQueries.length = 0; cfg.grnStatus = 'draft'; cfg.poLine = null; vi.clearAllMocks(); });

  it('runs the receipt posting inside a single transaction', async () => {
    const draftGrn = { id: 'g1', grn_number: 'GRN-1', status: 'draft', warehouse_id: 'loc-dc', supplier_name: 'S', warehouse_name: 'DC' };
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(draftGrn)
      .mockResolvedValue({ id: 'loc-vend' });
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-1', po_item_id: null, quantity_received: 10, quantity_rejected: 0, lot_number: null, total_cost: 100 }]);

    const req = makeReq({ grnId: 'g1' });
    const res = makeRes();
    await handler(req, res);

    expect(dbPool.transaction).toHaveBeenCalledTimes(1);
    expect(joined()).toMatch(/INSERT INTO stock_quants/i);
    expect(joined()).toMatch(/INSERT INTO field_stock_movements/i);
    expect(joined()).toMatch(/UPDATE goods_receipt_notes[\s\S]*completed/i);
    expect((res as { _status?: number })._status).toBe(200);
  });

  it('writes accepted quantity back to the linked PO line', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'g1', grn_number: 'GRN-2', status: 'draft', warehouse_id: 'loc-dc', purchase_order_id: 'po-1' })
      .mockResolvedValue({ id: 'loc-vend' });
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-1', po_item_id: 'poi-1', quantity_received: 8, quantity_rejected: 2, lot_number: null, total_cost: 0 }]);
    cfg.poLine = { quantity_ordered: 100, quantity_received: 5, item_code: 'ITEM-1' };

    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);

    expect((res as { _status?: number })._status).toBe(200);
    // accepted = 8 - 2 = 6; new received = 5 + 6 = 11.
    const poUpdate = txnQueries.find(q => /UPDATE purchase_order_items SET quantity_received/i.test(q.text));
    expect(poUpdate).toBeDefined();
    expect(poUpdate!.params).toEqual(['poi-1', 11]);
  });

  it('rejects an over-receipt (received > ordered) with 400 and no PO write', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'g1', grn_number: 'GRN-3', status: 'draft', warehouse_id: 'loc-dc', purchase_order_id: 'po-1' })
      .mockResolvedValue({ id: 'loc-vend' });
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-1', po_item_id: 'poi-1', quantity_received: 50, quantity_rejected: 0, lot_number: null, total_cost: 0 }]);
    cfg.poLine = { quantity_ordered: 100, quantity_received: 60, item_code: 'ITEM-1' }; // 60 + 50 = 110 > 100

    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);

    expect((res as { _status?: number })._status).toBe(400);
    expect(txnQueries.find(q => /UPDATE purchase_order_items SET quantity_received/i.test(q.text))).toBeUndefined();
  });

  it('returns 409 when a concurrent confirm already completed the GRN (FOR UPDATE re-check)', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'g1', grn_number: 'GRN-4', status: 'draft', warehouse_id: 'loc-dc' })
      .mockResolvedValue({ id: 'loc-vend' });
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-1', po_item_id: null, quantity_received: 1, quantity_rejected: 0, lot_number: null, total_cost: 0 }]);
    cfg.grnStatus = 'completed'; // the locked row shows it was already completed by a racer

    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);

    expect((res as { _status?: number })._status).toBe(409);
    expect(txnQueries.find(q => /INSERT INTO stock_quants/i.test(q.text))).toBeUndefined();
  });

  it('rejects a non-draft/receiving GRN with 400 and no transaction', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'g1', status: 'completed', warehouse_id: 'loc-dc' });
    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });

  it('returns 404 when the GRN does not exist', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = makeRes();
    await handler(makeReq({ grnId: 'missing' }), res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(404);
  });

  it('returns 400 when the GRN has no items', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'g1', status: 'draft', warehouse_id: 'loc-dc', grn_number: 'GRN-1' });
    (dbPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });

  it('returns 400 when the VENDORS location is missing', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'g1', status: 'draft', warehouse_id: 'loc-dc', grn_number: 'GRN-1' })
      .mockResolvedValueOnce(null);
    (dbPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ stock_item_id: 'item-1', po_item_id: null, quantity_received: 1, quantity_rejected: 0, lot_number: null, total_cost: 0 }]);
    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });

  it('rejects a missing grnId without hitting the DB', async () => {
    const res = makeRes();
    await handler(makeReq({}), res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBeGreaterThanOrEqual(400);
  });
});
