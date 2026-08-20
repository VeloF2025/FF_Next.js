/**
 * Tests for validateStockAvailability — error messages must name the item and
 * warehouse, not raw UUIDs. (PCK-000009/10 died with
 * "No stock record for item 84cc2348-… at source e61eef50-…" which the PWA
 * rendered as bare "Validation failed".)
 */

import { describe, it, expect, vi } from 'vitest';
import { validateStockAvailability } from '../[pickingId]/_availability';
import type { TxnClient } from '@/lib/db-pool';

const ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';
const SOURCE_ID = 'e61eef50-68ad-41d9-bcff-87b3a13445a2';

/** Fake txn that routes by target table and records every query. */
function fakeTxn(opts: {
  quants: Array<{ quantity: number }>;
  itemRow?: { item_code: string | null; name: string | null };
}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM stock_quants')) return opts.quants;
    if (sql.includes('FROM stock_locations')) return [{ name: 'Garstfontein DC' }];
    if (sql.includes('FROM stock_items')) {
      return [opts.itemRow ?? { item_code: 'FT-ONT', name: 'FT-ONT' }];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  const txn = { query } as unknown as TxnClient;
  const queriesTo = (table: string) =>
    query.mock.calls.filter((c) => (c[0] as string).includes(`FROM ${table}`)).length;
  return { txn, queriesTo };
}

const LINE = { id: 'line-1', stock_item_id: ITEM_ID, planned_quantity: 5 };

describe('validateStockAvailability', () => {
  it('names the item and warehouse when there is no stock record', async () => {
    const { txn } = fakeTxn({ quants: [] });

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
    const { txn } = fakeTxn({ quants: [{ quantity: 1 }] });

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

  it('passes on sufficient stock WITHOUT running any name lookups', async () => {
    const { txn, queriesTo } = fakeTxn({ quants: [{ quantity: 10 }] });

    const result = await validateStockAvailability(txn, [LINE], SOURCE_ID);

    expect(result.valid).toBe(true);
    expect(queriesTo('stock_locations')).toBe(0);
    expect(queriesTo('stock_items')).toBe(0);
  });

  it('memoizes name lookups across failing lines for the same item', async () => {
    const { txn, queriesTo } = fakeTxn({ quants: [] });
    const twoLines = [LINE, { ...LINE, id: 'line-2' }];

    const result = await validateStockAvailability(txn, twoLines, SOURCE_ID);

    expect(result.valid).toBe(false);
    expect(queriesTo('stock_locations')).toBe(1);
    expect(queriesTo('stock_items')).toBe(1);
  });

  it('falls back to name when item_code is an empty string', async () => {
    const { txn } = fakeTxn({
      quants: [],
      itemRow: { item_code: '', name: 'FT-ONT Router' },
    });

    const result = await validateStockAvailability(txn, [LINE], SOURCE_ID);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[ITEM_ID]).toContain('FT-ONT Router');
    }
  });

  it('scopes the availability check to the line lot_number', async () => {
    const { txn } = fakeTxn({ quants: [{ quantity: 10 }] });
    const lotLine = { ...LINE, lot_number: 'LOT-9' };

    await validateStockAvailability(txn, [lotLine], SOURCE_ID);

    const quantCall = (txn.query as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .find((c) => typeof c[0] === 'string' && /FROM stock_quants/.test(c[0] as string));
    expect(quantCall).toBeDefined();
    expect(quantCall![0]).toMatch(/COALESCE\(lot_number, ''\) = COALESCE\(\$3, ''\)/);
    expect(quantCall![1]).toEqual([ITEM_ID, SOURCE_ID, 'LOT-9']);
  });

  it('treats a line with no lot_number as the bulk/null-lot row (param null)', async () => {
    const { txn } = fakeTxn({ quants: [{ quantity: 10 }] });

    await validateStockAvailability(txn, [LINE], SOURCE_ID);

    const quantCall = (txn.query as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .find((c) => typeof c[0] === 'string' && /FROM stock_quants/.test(c[0] as string));
    expect(quantCall![1]).toEqual([ITEM_ID, SOURCE_ID, null]);
  });
});

/**
 * Serial-tracked lines are validated against the SERIALS, not stock_quants.
 *
 * stock_quants is a 26-May-2026 Odoo opening-balance snapshot with no
 * consumption postings; requiring a row from it refused genuine handouts
 * through 2026-07. The quants comparison still runs, but a disagreement is
 * now recorded to stock_quant_drift_log instead of failing the issue.
 */
describe('validateStockAvailability — serial-tracked lines', () => {
  const SERIAL_IDS = Array.from({ length: 9 }, (_, i) => `serial-${i}`);
  const SERIAL_LINE = {
    id: 'line-1',
    stock_item_id: ITEM_ID,
    planned_quantity: 9,
    serial_ids: SERIAL_IDS,
  };

  function serialTxn(opts: {
    serials?: Array<{ id: string; status: string; current_location_id: string | null }>;
    quants?: Array<{ quantity: number }>;
  }) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO stock_quant_drift_log')) return [];
      if (sql.includes('FROM stock_serials')) return opts.serials ?? [];
      if (sql.includes('FROM stock_quants')) return opts.quants ?? [];
      if (sql.includes('FROM stock_locations')) return [{ name: 'Garstfontein DC' }];
      if (sql.includes('FROM stock_items')) return [{ item_code: 'FT-ONT', name: 'FT-ONT' }];
      throw new Error(`Unexpected query: ${sql}`);
    });
    const txn = { query } as unknown as TxnClient;
    const driftInserts = () =>
      query.mock.calls.filter((c) => (c[0] as string).includes('INSERT INTO stock_quant_drift_log'));
    return { txn, query, driftInserts };
  }

  const allInStock = SERIAL_IDS.map((id) => ({
    id, status: 'in_stock', current_location_id: SOURCE_ID,
  }));

  it('passes when every serial is in stock at the source, even with no quants row', async () => {
    const { txn } = serialTxn({ serials: allInStock, quants: [] });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(true);
  });

  it('records the drift when quants disagree, without failing the issue', async () => {
    const { txn, driftInserts } = serialTxn({ serials: allInStock, quants: [{ quantity: 0 }] });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(true);
    expect(driftInserts()).toHaveLength(1);
    expect(driftInserts()[0]![1]).toEqual(['line-1', ITEM_ID, SOURCE_ID, 9, 0]);
  });

  it('records no drift when the ledgers agree', async () => {
    const { txn, driftInserts } = serialTxn({ serials: allInStock, quants: [{ quantity: 9 }] });
    await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(driftInserts()).toHaveLength(0);
  });

  it('fails when a serial is not in stock, naming how many', async () => {
    const { txn } = serialTxn({
      serials: [
        ...allInStock.slice(0, 8),
        { id: 'serial-8', status: 'issued', current_location_id: SOURCE_ID },
      ],
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[ITEM_ID]).toContain('1 of 9');
    expect(result.valid === false && result.errors[ITEM_ID]).toContain('Garstfontein DC');
  });

  it('fails when a serial sits at another warehouse', async () => {
    const { txn } = serialTxn({
      serials: [
        ...allInStock.slice(0, 8),
        { id: 'serial-8', status: 'in_stock', current_location_id: 'somewhere-else' },
      ],
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(false);
    // Must fail via the SERIAL path, not the old quants path — otherwise this
    // assertion would pass for the wrong reason.
    expect(result.valid === false && result.errors[ITEM_ID]).toContain('1 of 9');
  });

  it('fails when a serial row is missing entirely', async () => {
    const { txn } = serialTxn({ serials: allInStock.slice(0, 8) });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[ITEM_ID]).toContain('1 of 9');
  });

  it('allows a serial with no recorded location', async () => {
    const { txn } = serialTxn({
      serials: SERIAL_IDS.map((id) => ({ id, status: 'in_stock', current_location_id: null })),
      quants: [{ quantity: 9 }],
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(true);
  });

  it('leaves the quants path untouched for a line with no serials', async () => {
    const { txn } = serialTxn({ quants: [] });
    const result = await validateStockAvailability(txn, [LINE], SOURCE_ID);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors[ITEM_ID]).toContain('No stock of');
  });
});
