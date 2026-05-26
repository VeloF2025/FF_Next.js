import { describe, it, expect, vi } from 'vitest';
import { postGrnReceiptLines, type GrnLine } from '@/services/procurement/postGrnReceipt';

function fakeTxn() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    client: {} as never,
    query: vi.fn(async (text: string, params: unknown[] = []) => { calls.push({ text, params }); return []; }),
    queryOne: vi.fn(async () => null),
  };
}

const line = (over: Partial<GrnLine> = {}): GrnLine => ({
  stockItemId: 'item-1', quantityReceived: 10, quantityRejected: 2, lotNumber: null, ...over,
});

describe('postGrnReceiptLines', () => {
  it('posts accepted qty to quants + a receipt movement + qty_available, per line', async () => {
    const txn = fakeTxn();
    const total = await postGrnReceiptLines(txn as never, {
      lines: [line()], destinationLocationId: 'loc-dc', vendorsLocationId: 'loc-vend',
    });
    expect(total).toBe(8); // 10 received - 2 rejected
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/INSERT INTO stock_quants[\s\S]*ON CONFLICT/i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'receipt'/i);
    expect(sqls).toMatch(/UPDATE stock_items[\s\S]*qty_available/i);
    // accepted quantity (8) is the value passed to the quant upsert
    expect(txn.calls[0].params).toContain(8);
  });

  it('skips lines with zero accepted quantity (no writes)', async () => {
    const txn = fakeTxn();
    const total = await postGrnReceiptLines(txn as never, {
      lines: [line({ quantityReceived: 5, quantityRejected: 5 })],
      destinationLocationId: 'loc-dc', vendorsLocationId: 'loc-vend',
    });
    expect(total).toBe(0);
    expect(txn.calls).toHaveLength(0);
  });
});
