/**
 * Tests for validateStockAvailability — error messages must name the item and
 * warehouse, not raw UUIDs. (PCK-000009/10 died with
 * "No stock record for item 84cc2348-… at source e61eef50-…" which the PWA
 * rendered as bare "Validation failed".)
 */

import { describe, it, expect, vi } from 'vitest';
import { validateStockAvailability } from '../[pickingId]/process';
import type { TxnClient } from '@/lib/db-pool';

const ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';
const SOURCE_ID = 'e61eef50-68ad-41d9-bcff-87b3a13445a2';

/** Fake txn that routes by target table. */
function fakeTxn(opts: { quants: Array<{ quantity: number }> }): TxnClient {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM stock_quants')) return opts.quants;
    if (sql.includes('FROM stock_locations')) return [{ name: 'Garstfontein DC' }];
    if (sql.includes('FROM stock_items')) return [{ item_code: 'FT-ONT', name: 'FT-ONT' }];
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { query } as unknown as TxnClient;
}

const LINE = { id: 'line-1', stock_item_id: ITEM_ID, planned_quantity: 5 };

describe('validateStockAvailability', () => {
  it('names the item and warehouse when there is no stock record', async () => {
    const txn = fakeTxn({ quants: [] });

    const result = await validateStockAvailability(txn, [LINE], SOURCE_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors[ITEM_ID]!;
      expect(msg).toContain('FT-ONT');
      expect(msg).toContain('Garstfontein DC');
      expect(msg).not.toContain(ITEM_ID);
      expect(msg).not.toContain(SOURCE_ID);
    }
  });

  it('names the item and warehouse on insufficient stock and keeps the numbers', async () => {
    const txn = fakeTxn({ quants: [{ quantity: 1 }] });

    const result = await validateStockAvailability(txn, [LINE], SOURCE_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const msg = result.errors[ITEM_ID]!;
      expect(msg).toContain('FT-ONT');
      expect(msg).toContain('Garstfontein DC');
      expect(msg).toContain('5');
      expect(msg).toContain('1');
      expect(msg).not.toContain(ITEM_ID);
    }
  });

  it('passes when stock is sufficient without running name lookups', async () => {
    const txn = fakeTxn({ quants: [{ quantity: 10 }] });

    const result = await validateStockAvailability(txn, [LINE], SOURCE_ID);

    expect(result.valid).toBe(true);
  });
});
