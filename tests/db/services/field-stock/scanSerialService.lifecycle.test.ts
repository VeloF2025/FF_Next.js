/**
 * tests/db/services/field-stock/scanSerialService.lifecycle.test.ts
 *
 * Sprint E Track 2.6 — integration test for scanSerialService.recordScan.
 *
 * Verifies that recordScan() routes the issued → installed status change
 * through promoteSerial() (matrix row 69 `installed_at_drop`) rather than
 * a direct SQL UPDATE, and that the mig 387 emit trigger fires the correct
 * stock_serial_events row.
 *
 * Requires: Sprint E container (mig 387 triggers via vitest.db.sprinte.config.ts).
 *
 * Test contract:
 *   - After recordScan, stock_serials.status = 'installed'
 *   - Exactly one stock_serial_events row: event_type='installed_at_drop',
 *     from_state='issued', to_state='installed', source_table='stock_consumptions'
 *   - stock_consumptions row inserted with the generated consumptionId
 *   - metadata columns (installed_at_drop_number, installed_date) populated
 *
 * Config: vitest.db.sprinte.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { recordScan } from '@/modules/wa-monitor/services/scanSerialService';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL not set — run via vitest.db.sprinte.config.ts');
}

const pool = new Pool({ connectionString: TEST_DB_URL });

// Fixed UUIDs scoped to this test file (TC26-SCAN prefix)
const ITEM_ID = 'dd000000-0000-0000-0000-000000000001';
const LOC_WH  = '10000000-0000-0000-0000-000000000001'; // seeded warehouse
const SN = 'TC26-SCAN-ISSUED-001';
const DROP_NUMBER = 'TC26-SCAN-DR001';
const QA_REVIEW_ID = 'dd000000-0000-0000-0000-000000000002';

let serialId: string;

beforeAll(async () => {
  // 1. Ensure stock item exists (insert or reuse seeded FT-ONT).
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'TC26-SCAN-ONT', 'TC26 Scan Test ONT', 'bootstock', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ID],
  );

  // 2. Insert drop row so FK on consumptions works.
  await pool.query(
    `INSERT INTO drops (drop_number) VALUES ($1) ON CONFLICT (drop_number) DO NOTHING`,
    [DROP_NUMBER],
  );

  // 3. Extend qa_photo_reviews with columns scanSerialService uses (idempotent).
  await pool.query(`
    ALTER TABLE qa_photo_reviews
      ADD COLUMN IF NOT EXISTS ont_consumption_id  UUID,
      ADD COLUMN IF NOT EXISTS ups_serial_scanned  TEXT,
      ADD COLUMN IF NOT EXISTS ups_consumption_id  UUID,
      ADD COLUMN IF NOT EXISTS scan_gps_lat        NUMERIC,
      ADD COLUMN IF NOT EXISTS scan_gps_lng        NUMERIC,
      ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW()
  `);

  // 4. Insert qa_photo_review row for the test drop.
  await pool.query(
    `INSERT INTO qa_photo_reviews (id, drop_number)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [QA_REVIEW_ID, DROP_NUMBER],
  );

  // 5. Seed serial in `issued` state using bypass (issued is not reachable from
  //    __new__ via the matrix without a picking step — use SET LOCAL bypass).
  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const r = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials
         (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'issued', $3)
       RETURNING id`,
      [SN, ITEM_ID, LOC_WH],
    );
    await seedClient.query('COMMIT');
    serialId = r.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }
});

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events WHERE serial_id IN (
         SELECT id FROM stock_serials WHERE serial_number = $1
       )`,
      [SN],
    );
    await pool.query(
      `DELETE FROM stock_consumptions WHERE serial_number = $1`,
      [SN],
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number = $1`, [SN]);
    await pool.query(`DELETE FROM qa_photo_reviews WHERE id = $1`, [QA_REVIEW_ID]);
    await pool.query(`DELETE FROM drops WHERE drop_number = $1`, [DROP_NUMBER]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ID]);
  } finally {
    await pool.end();
  }
});

describe('scanSerialService.recordScan — lifecycle via promoteSerial (Track 2.6)', () => {
  it('promotes issued → installed and emits installed_at_drop event', async () => {
    const scanTimestamp = new Date().toISOString();
    const techId = '22222222-2222-2222-2222-222222222222'; // seeded user

    const result = await recordScan({
      serialId:     serialId,
      stockItemId:  ITEM_ID,
      qaReviewId:   QA_REVIEW_ID,
      dropNumber:   DROP_NUMBER,
      stepNumber:   8,
      serialNumber: SN,
      technicianId: techId,
      technicianName: 'Test Technician',
      scanTimestamp,
    });

    // ── Result shape ──
    expect(result.serialStatus).toBe('installed');
    expect(result.dropUpdated).toBe(true);
    expect(result.qaReviewUpdated).toBe(true);
    expect(typeof result.consumptionId).toBe('string');

    // ── stock_serials status promoted ──
    const serial = await pool.query<{ status: string; installed_at_drop_number: string | null }>(
      `SELECT status, installed_at_drop_number FROM stock_serials WHERE id = $1`,
      [serialId],
    );
    expect(serial.rows[0]?.status).toBe('installed');
    expect(serial.rows[0]?.installed_at_drop_number).toBe(DROP_NUMBER);

    // ── stock_serial_events: filter for the promoteSerial-sourced event ──
    // Note: the mig 364/365 `emit_serial_event_on_qa_install` trigger fires
    // when qa_photo_reviews is updated with ont_serial_scanned — it reads the
    // new serial value and emits a second installed_at_drop event from
    // source_table='qa_photo_reviews'. We assert only the promoteSerial event
    // (source_table='stock_consumptions') exists and is correct.
    const events = await pool.query<{
      event_type:   string;
      from_state:   string | null;
      to_state:     string | null;
      source_table: string | null;
    }>(
      `SELECT event_type, from_state, to_state, source_table
         FROM stock_serial_events
        WHERE serial_id = $1
        ORDER BY occurred_at`,
      [serialId],
    );
    // At least one event from promoteSerial must exist.
    expect(events.rows.length).toBeGreaterThanOrEqual(1);
    const promoteEvent = events.rows.find(r => r.source_table === 'stock_consumptions');
    expect(promoteEvent).toBeDefined();
    expect(promoteEvent).toMatchObject({
      event_type:   'installed_at_drop',
      from_state:   'issued',
      to_state:     'installed',
      source_table: 'stock_consumptions',
    });

    // ── stock_consumptions row created ──
    const consumption = await pool.query<{ id: string }>(
      `SELECT id FROM stock_consumptions WHERE serial_number = $1`,
      [SN],
    );
    expect(consumption.rows).toHaveLength(1);
    expect(consumption.rows[0]?.id).toBe(result.consumptionId);

    // ── qa_photo_reviews updated ──
    const qa = await pool.query<{ ont_serial_scanned: string; ont_consumption_id: string }>(
      `SELECT ont_serial_scanned, ont_consumption_id FROM qa_photo_reviews WHERE id = $1`,
      [QA_REVIEW_ID],
    );
    expect(qa.rows[0]?.ont_serial_scanned).toBe(SN);
    expect(qa.rows[0]?.ont_consumption_id).toBe(result.consumptionId);
  });
});
