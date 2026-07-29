/**
 * tests/db/services/field-stock/serialIntake.lifecycle.test.ts
 *
 * Integration test for receiveSerials() — the ONT/Gizzu stock-receipt genesis
 * path (issue #1864 recurring intake).
 *
 * Verifies that receiving a brand-new serial:
 *   - inserts a stock_serials row with status='in_stock'
 *   - fires the mig 387 AFTER-INSERT emit trigger, producing exactly one
 *     stock_serial_events row: event_type='received', from_state=NULL,
 *     to_state='in_stock', with the caller's source_table attribution
 *   - is idempotent: re-receiving the same serial inserts nothing and emits
 *     no further event (ON CONFLICT DO NOTHING — no status write, no trigger)
 *
 * Requires: Sprint E container (mig 387 triggers via vitest.db.sprinte.config.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { receiveSerials } from '@/modules/procurement/field-stock/services/serialIntake';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL not set — run via vitest.db.sprinte.config.ts');
}

const pool = new Pool({ connectionString: TEST_DB_URL });

// Fixed UUIDs scoped to this test file (TC-INTAKE prefix).
const ITEM_ID = 'dd000000-0000-0000-0000-0000000000a1';
const LOC_WH = '10000000-0000-0000-0000-000000000001'; // seeded warehouse
const SN = 'TC-INTAKE-ONT-0001';
const SN_NULL_LOCATION = 'TC-INTAKE-ONT-0002';

beforeAll(async () => {
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'TC-INTAKE-ONT', 'TC Intake Test ONT', 'bootstock', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ID],
  );
  // Clean any residue from a prior run so counts are deterministic.
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN (SELECT id FROM stock_serials WHERE stock_item_id = $1)`,
    [ITEM_ID],
  );
  await pool.query(`DELETE FROM stock_serials WHERE stock_item_id = $1`, [ITEM_ID]);
});

afterAll(async () => {
  await pool.end();
});

describe('receiveSerials — genesis stock receipt', () => {
  it('inserts a new serial as in_stock and emits a received genesis event', async () => {
    const result = await receiveSerials(
      pool,
      [{ stockItemId: ITEM_ID, serialNumber: SN, locationId: LOC_WH }],
      { sourceTable: 'ont_serial_import', sourceId: randomUUID(), receivedReference: 'TEST IMPORT' },
    );
    expect(result).toEqual({ received: 1, skipped: 0 });

    const { rows: serials } = await pool.query(
      `SELECT status, received_reference, current_location_id
         FROM stock_serials WHERE stock_item_id = $1 AND serial_number = $2`,
      [ITEM_ID, SN],
    );
    expect(serials).toHaveLength(1);
    expect(serials[0].status).toBe('in_stock');
    expect(serials[0].received_reference).toBe('TEST IMPORT');
    expect(serials[0].current_location_id).toBe(LOC_WH);

    const { rows: events } = await pool.query(
      `SELECT e.event_type, e.from_state, e.to_state, e.source_table
         FROM stock_serial_events e
         JOIN stock_serials s ON s.id = e.serial_id
        WHERE s.stock_item_id = $1 AND s.serial_number = $2`,
      [ITEM_ID, SN],
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'received',
      from_state: null,
      to_state: 'in_stock',
      source_table: 'ont_serial_import',
    });
  });

  it('is idempotent — re-receiving the same serial inserts nothing and emits no new event', async () => {
    const result = await receiveSerials(
      pool,
      [{ stockItemId: ITEM_ID, serialNumber: SN, locationId: LOC_WH }],
      { sourceTable: 'ont_serial_import', sourceId: randomUUID(), receivedReference: 'TEST IMPORT 2' },
    );
    expect(result).toEqual({ received: 0, skipped: 1 });

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM stock_serial_events e
         JOIN stock_serials s ON s.id = e.serial_id
        WHERE s.stock_item_id = $1`,
      [ITEM_ID],
    );
    expect(rows[0].n).toBe(1);
  });

  it('zips a multi-row batch with null locations and skips conflicts', async () => {
    const result = await receiveSerials(
      pool,
      [
        { stockItemId: ITEM_ID, serialNumber: SN, locationId: LOC_WH },
        { stockItemId: ITEM_ID, serialNumber: SN_NULL_LOCATION, locationId: null },
      ],
      { sourceTable: 'ont_serial_import', sourceId: randomUUID(), receivedReference: 'BATCH TEST' },
    );
    expect(result).toEqual({ received: 1, skipped: 1 });

    const { rows: serials } = await pool.query(
      `SELECT serial_number, current_location_id, received_reference
         FROM stock_serials
        WHERE stock_item_id = $1
        ORDER BY serial_number`,
      [ITEM_ID],
    );
    expect(serials).toHaveLength(2);
    expect(serials[1]).toMatchObject({
      serial_number: SN_NULL_LOCATION,
      current_location_id: null,
      received_reference: 'BATCH TEST',
    });

    const { rows: events } = await pool.query(
      `SELECT e.source_table
         FROM stock_serial_events e
         JOIN stock_serials s ON s.id = e.serial_id
        WHERE s.stock_item_id = $1
        ORDER BY s.serial_number`,
      [ITEM_ID],
    );
    expect(events).toHaveLength(2);
    expect(events[1]?.source_table).toBe('ont_serial_import');
  });
});
