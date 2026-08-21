import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/serialEventContext', () => ({
  withSerialEventContext: vi.fn(
    async (_client: unknown, _context: unknown, operation: () => Promise<unknown>) => operation(),
  ),
}));
vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { receiveSerials } from '../serialIntake';

const STOCK_ITEM_ID = '84cc2348-f8a9-486f-826a-6b8b20579765';

/**
 * @param insertedPerChunk rows genuinely INSERTed per chunk
 * @param confirmedPerChunk field_intake rows the sheet caught up with per chunk
 *
 * The statement now RETURNs one row per affected serial with `was_insert`
 * (`xmax = 0`), because ON CONFLICT DO UPDATE makes rowCount count
 * confirmations too. Verified against real Postgres 2026-08-21: a genuine
 * insert returns true, a confirmed field_intake row returns false, and an
 * ordinary already-present serial is not returned at all.
 */
function makePool(insertedPerChunk: number[], confirmedPerChunk: number[] = []) {
  const remaining = [...insertedPerChunk];
  const remainingConfirmed = [...confirmedPerChunk];
  const query = vi.fn(async (sql: string) => {
    if (!sql.includes('INSERT INTO stock_serials')) return { rowCount: null, rows: [] };
    const inserts = remaining.shift() ?? 0;
    const confirms = remainingConfirmed.shift() ?? 0;
    const rows = [
      ...Array.from({ length: inserts }, () => ({ was_insert: true })),
      ...Array.from({ length: confirms }, () => ({ was_insert: false })),
    ];
    return { rowCount: rows.length, rows };
  });
  const client = {
    query,
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
  return { pool, client };
}

describe('receiveSerials batching', () => {
  it('receives each 500-row chunk with one set-based insert', async () => {
    const { pool, client } = makePool([500, 1]);
    const items = Array.from({ length: 501 }, (_, index) => ({
      stockItemId: STOCK_ITEM_ID,
      serialNumber: `ALCLB4${String(index).padStart(6, '0')}`,
      locationId: null,
    }));

    const result = await receiveSerials(pool, items, {
      sourceTable: 'ont_serial_sync',
      sourceId: '11111111-1111-4111-8111-111111111111',
      receivedReference: 'TEST',
    });

    expect(result).toEqual({ received: 501, skipped: 0, confirmed: 0 });
    expect(pool.connect).toHaveBeenCalledTimes(2);

    const inserts = client.query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO stock_serials'),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.[0]).toMatch(/unnest\(/i);
    // Still upserting on the composite key, but DO UPDATE now — narrowly, so
    // it confirms an unlisted field_intake serial and touches nothing else.
    expect(inserts[0]?.[0]).toMatch(/ON CONFLICT \(stock_item_id, serial_number\) DO UPDATE/);
    expect(inserts[0]?.[0]).toMatch(/provenance = 'field_intake'/);
    expect(inserts[0]?.[0]).toMatch(/source_confirmed_at IS NULL/);
    // The confirmation must not disturb a serial already issued to a
    // technician: only the timestamps are written.
    expect(inserts[0]?.[0]).not.toMatch(/DO UPDATE[\s\S]*SET[\s\S]*status\s*=/);
    expect(inserts[0]?.[0]).not.toMatch(/DO UPDATE[\s\S]*SET[\s\S]*current_location_id\s*=/);

    const firstParams = inserts[0]?.[1] as unknown[];
    expect(firstParams[0]).toHaveLength(500);
    expect(firstParams[1]).toHaveLength(500);
    expect(firstParams[2]).toHaveLength(500);
    expect(firstParams[3]).toHaveLength(500);
  });

  it('counts conflicts as skipped without changing the set-based path', async () => {
    const { pool } = makePool([1]);

    const result = await receiveSerials(
      pool,
      [
        { stockItemId: STOCK_ITEM_ID, serialNumber: 'ALCLB4A', locationId: null },
        { stockItemId: STOCK_ITEM_ID, serialNumber: 'ALCLB4B', locationId: null },
      ],
      {
        sourceTable: 'ont_serial_sync',
        sourceId: '11111111-1111-4111-8111-111111111111',
        receivedReference: 'TEST',
      },
    );

    expect(result).toEqual({ received: 1, skipped: 1, confirmed: 0 });
  });
});

describe('reconciling serials taken in from the field', () => {
  // Migration 515: a serial issued from a scanned carton before the workbook
  // listed it is `field_intake` with source_confirmed_at NULL. When the sheet
  // finally lists it, this import is what confirms it — otherwise every one
  // would sit on the unconfirmed ageing report forever.
  it('counts a confirmation apart from a genuine insert', async () => {
    const { pool } = makePool([2], [3]);
    const items = Array.from({ length: 5 }, (_, i) => ({
      stockItemId: STOCK_ITEM_ID,
      serialNumber: `ALCLB4948${String(i).padStart(3, '0')}`,
      locationId: null,
    }));

    const result = await receiveSerials(pool, items, {
      sourceTable: 'sharepoint', sourceId: null, payload: {}, receivedReference: 'REF',
    });

    // 2 new + 3 confirmed. Counting confirmations as `received` would make a
    // sync that imported nothing look like it imported three ONTs.
    expect(result).toEqual({ received: 2, skipped: 0, confirmed: 3 });
  });

  it('does not report a confirmation when the sheet brings only new serials', async () => {
    const { pool } = makePool([4], [0]);
    const items = Array.from({ length: 4 }, (_, i) => ({
      stockItemId: STOCK_ITEM_ID, serialNumber: `NEW${i}`, locationId: null,
    }));
    const result = await receiveSerials(pool, items, {
      sourceTable: 'sharepoint', sourceId: null, payload: {}, receivedReference: 'REF',
    });
    expect(result).toEqual({ received: 4, skipped: 0, confirmed: 0 });
  });

  it('still counts an ordinary already-present serial as skipped', async () => {
    // An ordinary 'sheet' serial matches the DO UPDATE's WHERE clause not at
    // all, so Postgres returns no row for it — it must land in `skipped`, not
    // be silently lost from the totals.
    const { pool } = makePool([0], [0]);
    const items = Array.from({ length: 3 }, (_, i) => ({
      stockItemId: STOCK_ITEM_ID, serialNumber: `OLD${i}`, locationId: null,
    }));
    const result = await receiveSerials(pool, items, {
      sourceTable: 'sharepoint', sourceId: null, payload: {}, receivedReference: 'REF',
    });
    expect(result).toEqual({ received: 0, skipped: 3, confirmed: 0 });
  });
});

