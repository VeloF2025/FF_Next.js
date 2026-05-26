import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const txnQueries: string[] = [];
vi.mock('@/lib/db-pool', () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  transaction: vi.fn(async (cb: (t: unknown) => Promise<unknown>) => cb({
    // Return a row for RETURNING queries (so the movement id is defined); [] otherwise.
    query: vi.fn(async (text: string) => { txnQueries.push(text); return /RETURNING/i.test(text) ? [{ id: 'mv-1' }] : []; }),
    queryOne: vi.fn(async () => null),
    client: {},
  })),
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []), unsafe: (s: string) => s }),
}));
// withAuth is mocked as pass-through; the req must carry a .user object
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

describe('POST /api/procurement/grn-confirm', () => {
  beforeEach(() => { txnQueries.length = 0; vi.clearAllMocks(); });

  it('runs the receipt posting inside a single transaction', async () => {
    const draftGrn = { id: 'g1', grn_number: 'GRN-1', status: 'draft', warehouse_id: 'loc-dc', supplier_name: 'S', warehouse_name: 'DC' };
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(draftGrn)              // load GRN
      .mockResolvedValue({ id: 'loc-vend' });        // VENDORS lookup (and any later queryOne)
    (dbPool.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ stock_item_id: 'item-1', quantity_received: 10, quantity_rejected: 0, lot_number: null, total_cost: 100 }]); // GRN items

    const req = makeReq({ grnId: 'g1' });
    const res = makeRes();
    await handler(req, res);

    expect(dbPool.transaction).toHaveBeenCalledTimes(1);
    const joined = txnQueries.join('\n');
    expect(joined).toMatch(/INSERT INTO stock_quants/i);
    expect(joined).toMatch(/INSERT INTO field_stock_movements/i);
    expect(joined).toMatch(/INSERT INTO stock_movement_items/i);
    expect(joined).toMatch(/UPDATE goods_receipt_notes[\s\S]*completed/i);
    expect((res as { _status?: number })._status).toBe(200);
  });

  it('rejects a non-draft/receiving GRN with 400 and no transaction', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'g1', status: 'completed', warehouse_id: 'loc-dc' });
    const req = makeReq({ grnId: 'g1' });
    const res = makeRes();
    await handler(req, res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });

  it('returns 404 when the GRN does not exist', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const req = { method: 'POST', body: { grnId: 'missing' }, query: {}, headers: {}, user: { id: 'u' } } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(404);
  });

  it('returns 400 when the GRN has no items', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'g1', status: 'draft', warehouse_id: 'loc-dc', grn_number: 'GRN-1' });
    (dbPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const req = { method: 'POST', body: { grnId: 'g1' }, query: {}, headers: {}, user: { id: 'u' } } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });

  it('returns 400 when the VENDORS location is missing', async () => {
    (dbPool.queryOne as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'g1', status: 'draft', warehouse_id: 'loc-dc', grn_number: 'GRN-1' })
      .mockResolvedValueOnce(null);
    (dbPool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ stock_item_id: 'item-1', quantity_received: 1, quantity_rejected: 0, lot_number: null, total_cost: 0 }]);
    const req = { method: 'POST', body: { grnId: 'g1' }, query: {}, headers: {}, user: { id: 'u' } } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBe(400);
  });

  it('rejects a missing grnId without hitting the DB', async () => {
    const req = { method: 'POST', body: {}, query: {}, headers: {}, user: { id: 'u' } } as unknown as NextApiRequest;
    const res = makeRes();
    await handler(req, res);
    expect(dbPool.transaction).not.toHaveBeenCalled();
    expect((res as { _status?: number })._status).toBeGreaterThanOrEqual(400);
  });
});
