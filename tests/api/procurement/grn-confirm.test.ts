import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

interface RecordedQuery { text: string; params: unknown[] }
const txnQueries: RecordedQuery[] = [];

// Configurable per-test canned rows for the in-transaction PO-line lookup.
const cfg: { grnStatus: string; poLine: Record<string, unknown> | null; cumulativeReceived: number } = {
  grnStatus: 'draft',
  poLine: null,
  // What SUM(quantity_accepted) over goods_receipt_items returns for the PO
  // line — the trigger-maintained figure the handler now reads back.
  cumulativeReceived: 0,
};

vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      txnQueries.push({ text, params });
      if (/goods_receipt_notes[\s\S]*FOR UPDATE/i.test(text)) return [{ status: cfg.grnStatus }];
      if (/purchase_order_items[\s\S]*FOR UPDATE/i.test(text)) return cfg.poLine ? [cfg.poLine] : [];
      if (/SUM\(quantity_accepted\)[\s\S]*goods_receipt_items/i.test(text)) return [{ received: cfg.cumulativeReceived }];
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
  beforeEach(() => {
    txnQueries.length = 0; cfg.grnStatus = 'draft'; cfg.poLine = null; cfg.cumulativeReceived = 0;
    vi.clearAllMocks();
  });

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
    // The trigger has already folded this GRN's accepted 6 into the cumulative
    // total (5 from an earlier receipt + 6 = 11). The handler must write that
    // figure, NOT add its own 6 on top of a column that already contains it.
    cfg.poLine = { quantity_ordered: 100, quantity_received: 11, item_code: 'ITEM-1' };
    cfg.cumulativeReceived = 11;

    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);

    expect((res as { _status?: number })._status).toBe(200);
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
    // A genuine over-receipt: 110 accepted in total against 100 ordered.
    cfg.poLine = { quantity_ordered: 100, quantity_received: 110, item_code: 'ITEM-1' };
    cfg.cumulativeReceived = 110;

    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);

    expect((res as { _status?: number })._status).toBe(400);
    expect(txnQueries.find(q => /UPDATE purchase_order_items SET quantity_received/i.test(q.text))).toBeUndefined();
  });

  it('confirms a full receipt without double-counting the trigger-maintained quantity', async () => {
    // Lizelle's GRN26-00329 against PO-2026-0240 on 2026-08-20: 500 received
    // against 500 ordered. update_poi_received() had already set the column to
    // 500 on insert, so the old "column + accepted" arithmetic reported
    // "1000 received vs 500 ordered" and refused an exactly-complete receipt.
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'g1', grn_number: 'GRN26-00329', status: 'draft', warehouse_id: 'loc-dc', purchase_order_id: 'po-1' })
      .mockResolvedValue({ id: 'loc-vend' });
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-4', po_item_id: 'poi-4', quantity_received: 500, quantity_rejected: 0, lot_number: null, total_cost: 0 }]);
    cfg.poLine = { quantity_ordered: 500, quantity_received: 500, item_code: 'ITEM-4' };
    cfg.cumulativeReceived = 500;

    const res = makeRes();
    await handler(makeReq({ grnId: 'g1' }), res);

    expect((res as { _status?: number })._status).toBe(200);
    const poUpdate = txnQueries.find(q => /UPDATE purchase_order_items SET quantity_received/i.test(q.text));
    expect(poUpdate!.params).toEqual(['poi-4', 500]);
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
