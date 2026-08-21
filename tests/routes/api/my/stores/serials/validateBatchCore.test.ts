/**
 * Tests for runBatchValidation — the core of POST /my/stores/serials/validate-batch.
 *
 * A fake querier stands in for pg. What matters:
 *  - a serial the query does not return is reported not-found, not silently dropped
 *  - results come back in the order the client scanned them
 *  - the quants comparison reports drift without failing any serial
 */
import { describe, it, expect, vi } from 'vitest';
import { runBatchValidation } from '@/pages/api/my/stores/serials/_validateBatchCore';
import type { BatchQuerier } from '@/pages/api/my/stores/serials/_validateBatchCore';

const SOURCE_ID = 'loc-garst';

function querier(
  serialRows: unknown[],
  quantRows: unknown[] = [],
  locationRows: unknown[] = [{ name: 'Garstfontein DC' }],
): BatchQuerier {
  const query = vi.fn(async (text: string) => {
    if (text.includes('FROM stock_serials')) return serialRows;
    if (text.includes('FROM stock_quants')) return quantRows;
    return locationRows;
  });
  return { query } as unknown as BatchQuerier;
}

function row(over: Record<string, unknown> = {}) {
  return {
    serial_number: 'ALCLB49486FF',
    stock_item_id: 'item-ont',
    stock_item_name: 'FT-ONT',
    status: 'in_stock',
    current_location_id: SOURCE_ID,
    current_location_name: 'Garstfontein DC',
    ...over,
  };
}

describe('runBatchValidation', () => {
  it('accepts every serial in a clean box', async () => {
    const serials = ['ALCLB49486FF', 'ALCLB4948758'];
    const db = querier([row(), row({ serial_number: 'ALCLB4948758' })]);
    const res = await runBatchValidation(db, {
      serials,
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.map((r) => r.valid)).toEqual([true, true]);
  });

  it('reports a serial missing from the database, naming what would admit it', async () => {
    const db = querier([row()]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB0000MISSING'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results[1]).toMatchObject({
      // The message names the way forward rather than dead-ending: a bare
      // 'not found' is what left two real Gizzu handouts unrecorded on
      // 2026-08-21. A batch caller with no carton payload and no photo still
      // gets a refusal, just an actionable one.
      serialNumber: 'ALCLB0000MISSING', valid: false,
      errorMessage: 'Not in the system — take a photo of the label to record it',
    });
  });

  it('issues the good members and flags the bad one in a partial box', async () => {
    // A serial at another warehouse is ALLOWED, not rejected (see the note atop
    // serialVerdict.ts — that location is an assumption, and refusing the
    // handout on it blocks real work over a guess). Only the issued serial is
    // an actual mistake here.
    const db = querier([
      row(),
      row({ serial_number: 'ALCLB4948758', status: 'issued' }),
      row({
        serial_number: 'ALCLB4948779',
        current_location_id: 'loc-lawley',
        current_location_name: 'Lawley',
      }),
    ]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.map((r) => r.valid)).toEqual([true, false, true]);
    expect(res.results[1]!.errorMessage).toContain('status: issued');
  });

  it('returns results in the scanned order, not the database order', async () => {
    const db = querier([row({ serial_number: 'ALCLB4948758' }), row()]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.map((r) => r.serialNumber)).toEqual(['ALCLB49486FF', 'ALCLB4948758']);
  });

  it('reports quants drift without failing any serial', async () => {
    const db = querier([row(), row({ serial_number: 'ALCLB4948758' })], [{ quantity: 0 }]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.every((r) => r.valid)).toBe(true);
    expect(res.quantsWarning).toEqual({ serialsInStock: 2, quantsOnHand: 0 });
  });

  it('omits the quants warning when the ledgers agree', async () => {
    const db = querier([row(), row({ serial_number: 'ALCLB4948758' })], [{ quantity: 2 }]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.quantsWarning).toBeUndefined();
  });

  it('skips the quants query entirely when no source warehouse is given', async () => {
    const db = querier([row()]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF'], stockItemId: 'item-ont', sourceLocationId: null,
    });
    expect(res.quantsWarning).toBeUndefined();
    const texts = (db.query as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]!);
    expect(texts.some((t) => t.includes('FROM stock_quants'))).toBe(false);
  });

  it('prefers the row for the item being issued when a serial exists under two items', async () => {
    // stock_serials is unique on (stock_item_id, serial_number), so the same
    // serial can legitimately belong to two SKUs. Returning the other item's row
    // would wrongly reject a serial that is valid for this issue.
    const db = querier([
      row({ stock_item_id: 'item-gizzu', stock_item_name: 'FT-GIZZU' }),
      row(),
    ]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF'], stockItemId: 'item-ont', sourceLocationId: SOURCE_ID,
    });
    expect(res.results[0]!.valid).toBe(true);
    expect(res.results[0]!.stockItemId).toBe('item-ont');
  });

  it('still reports wrong-item when the serial exists only under another item', async () => {
    const db = querier([row({ stock_item_id: 'item-gizzu', stock_item_name: 'FT-GIZZU' })]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF'], stockItemId: 'item-ont', sourceLocationId: SOURCE_ID,
    });
    expect(res.results[0]!.valid).toBe(false);
    expect(res.results[0]!.errorMessage).toContain('Wrong stock item');
  });

  it('passes serials as a single parameterised array, never interpolated', async () => {
    const db = querier([row()]);
    await runBatchValidation(db, {
      serials: ["ALCLB49486FF'; DROP TABLE stock_serials;--"],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    const call = (db.query as unknown as { mock: { calls: [string, unknown[]][] } }).mock.calls[0]!;
    expect(call[0]).not.toContain('DROP TABLE');
    expect(call[1][0]).toEqual(["ALCLB49486FF'; DROP TABLE stock_serials;--"]);
  });
});
