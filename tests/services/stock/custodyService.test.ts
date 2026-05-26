import { describe, it, expect, vi } from 'vitest';
import {
  postIssueToHolderWith, postConsumeFromHolderWith, postReturnFromHolderWith,
  type CustodyLine,
} from '@/modules/procurement/field-stock/services/custodyService';

function fakeTxn() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls, client: {} as never,
    query: vi.fn(async (text: string, params: unknown[] = []) => { calls.push({ text, params }); return []; }),
    queryOne: vi.fn(async () => null),
  };
}
const line = (o: Partial<CustodyLine> = {}): CustodyLine =>
  ({ stockItemId: 'item-1', quantity: 3, lotNumber: null, unitCost: 100, ...o });

describe('custodyService', () => {
  it('issue: debits source quant, credits holder custody, posts an issue movement (location->holder)', async () => {
    const txn = fakeTxn();
    const total = await postIssueToHolderWith(txn as never, {
      lines: [line()], sourceLocationId: 'loc-dc', toHolderId: 'holder-1', reference: 'PICK-1',
    });
    expect(total).toBe(3);
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/UPDATE stock_quants[\s\S]*quantity = stock_quants.quantity - /i);
    expect(sqls).toMatch(/INSERT INTO stock_custody[\s\S]*ON CONFLICT[\s\S]*quantity = stock_custody.quantity \+ /i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'issue'[\s\S]*to_holder_id/i);
    expect(txn.calls.some((c) => c.params.includes('holder-1'))).toBe(true);
  });

  it('consume: debits holder custody and posts a consumption movement (from_holder, no to side)', async () => {
    const txn = fakeTxn();
    await postConsumeFromHolderWith(txn as never, {
      stockItemId: 'item-1', quantity: 1, lotNumber: null, unitCost: 100, fromHolderId: 'holder-1', reference: 'DR-9',
    });
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/UPDATE stock_custody[\s\S]*quantity = stock_custody.quantity - /i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'consumption'[\s\S]*from_holder_id/i);
  });

  it('return: debits holder custody, credits warehouse quant, posts a return movement (holder->location)', async () => {
    const txn = fakeTxn();
    const total = await postReturnFromHolderWith(txn as never, {
      lines: [line({ quantity: 2 })], fromHolderId: 'holder-1', toLocationId: 'loc-wh', reference: 'RET-3',
    });
    expect(total).toBe(2);
    const sqls = txn.calls.map((c) => c.text).join('\n');
    expect(sqls).toMatch(/UPDATE stock_custody[\s\S]*quantity = stock_custody.quantity - /i);
    expect(sqls).toMatch(/INSERT INTO stock_quants[\s\S]*ON CONFLICT[\s\S]*quantity = stock_quants.quantity \+ /i);
    expect(sqls).toMatch(/INSERT INTO field_stock_movements[\s\S]*'return'[\s\S]*from_holder_id[\s\S]*to_location_id/i);
  });

  it('issue: skips lines with empty stockItemId or <=0 qty (no writes)', async () => {
    const txn = fakeTxn();
    const total = await postIssueToHolderWith(txn as never, {
      lines: [line({ stockItemId: '' }), line({ quantity: 0 })], sourceLocationId: 'loc-dc', toHolderId: 'h',
    });
    expect(total).toBe(0);
    expect(txn.calls).toHaveLength(0);
  });
});
