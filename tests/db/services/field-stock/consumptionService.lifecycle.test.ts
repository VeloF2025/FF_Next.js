/**
 * tests/db/services/field-stock/consumptionService.lifecycle.test.ts
 *
 * Integration test for recordConsumption's Track 4.3 off-book guard (SOP-4.4):
 * a serialised consumption with no resolvable holder is rejected with
 * OffBookConsumptionError BEFORE any write. Bulk (non-serialised) consumption
 * is unaffected.
 *
 * Requirements for PASS:
 *   - Sprint E container (mig 387 triggers installed via vitest.db.sprinte.config.ts)
 *   - stock_consumptions with full prod-schema columns (extended sprint-e-seed.sql)
 *
 * NOTE — the holder-backed SUCCESS path (which would re-assert the Task-2.1
 * promoteSerial-via-consumption wiring) is intentionally NOT tested here yet.
 * Track 4.3 forbids the off-book path (serial + no holder), so the only
 * legitimate serialised-consumption path now goes through the holder custody
 * debit (custodyService.postConsumeFromHolderWith) — which currently fails
 * against real Postgres with `42P08 inconsistent types deduced` in the
 * `COALESCE($cost,0) * $qty` arithmetic (numeric column vs integer literal).
 * That is a pre-existing latent custodyService bug (the write path has 0 rows
 * in prod and the custody unit tests are SQL-text assertions, so it was never
 * exercised). Filed as #1831; the positive promoteSerial-via-consumption test
 * is restored once those casts land.
 *
 * Isolation: uses TRACK43-CONS- prefixed serial numbers; afterAll cleans up
 * stock_serial_events and stock_serials rows.
 *
 * Design choices:
 * - No `serialNumber` in input → skips `validateSerialForConsumption`
 *   (service guard: `if (input.serialId && input.serialNumber)`). The serial
 *   service queries prod-only columns (s.imei, etc.) not present in the sprint-e
 *   seed schema. The off-book guard fires on serialId + null-holder regardless.
 *
 * - Seeding in 'issued' state: ('__new__', 'issued') is not in the transition
 *   matrix, so the validate trigger would reject a direct INSERT. We use
 *   bypass=true for the seed INSERT, then delete the seed event so the
 *   "no events written" assertion starts from a clean slate.
 *
 * Config: vitest.db.sprinte.config.ts (Sprint E Docker + mig 387)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool }              from 'pg';
import {
  recordConsumption,
  OffBookConsumptionError,
} from '@/modules/procurement/field-stock/services/consumptionService';

// ─── Fixed seed references (from tests/db/setup/seed.sql) ────────────────────
const LOC_TECH_ID = '10000000-0000-0000-0000-000000000002'; // TECH-001
const DROP_ID     = '44444444-4444-4444-4444-444444444444'; // DR0000001
const DROP_NUMBER = 'DR0000001';

/** Prefix-scoped so afterAll DELETE is safe and won't touch unrelated rows. */
const SN_PREFIX = 'TRACK43-CONS-';

// ─── Module-level pool (global setup points TEST_DATABASE_URL at Docker) ─────
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let itemId:          string;
let offBookSerialId: string;

// ─── beforeAll: seed stock_item + a serial in 'issued' state ─────────────────
beforeAll(async () => {
  // Stock item with generic code — irrelevant to the guard, kept minimal.
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK43-GENERIC', 'TRACK43 Generic Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  itemId = itemRes.rows[0].id;

  // Seed the serial in 'issued' via bypass (('__new__','issued') is not a
  // matrix transition), then strip the auto-emitted event so the
  // "no events written" assertion is clean.
  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const res = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'issued', $3)
       RETURNING id`,
      [`${SN_PREFIX}OFFBOOK-001`, itemId, LOC_TECH_ID],
    );
    await seedClient.query('COMMIT');
    offBookSerialId = res.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }
  await pool.query(`DELETE FROM stock_serial_events WHERE serial_id = $1`, [offBookSerialId]);
});

// ─── afterAll: remove seeded rows in FK-safe order ───────────────────────────
afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events
        WHERE serial_id IN (
          SELECT id FROM stock_serials WHERE serial_number LIKE $1
        )`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM stock_consumptions WHERE serial_id = ANY(
         SELECT id FROM stock_serials WHERE serial_number LIKE $1
       )`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM stock_serials WHERE serial_number LIKE $1`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM stock_items WHERE item_code = 'TRACK43-GENERIC'`,
    );
  } finally {
    await pool.end();
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('recordConsumption — off-book guard (Track 4.3, SOP-4.4)', () => {
  /**
   * A serialised consumption with no resolvable holder (no holderId, no
   * consumedById) must throw OffBookConsumptionError and write NOTHING — the
   * guard fires after holder resolution but before the transaction opens.
   */
  it('rejects a serialised consumption with no holder and leaves no side effects', async () => {
    await expect(
      recordConsumption({
        jobType:                'drop',
        dropId:                 DROP_ID,
        dropNumber:             DROP_NUMBER,
        stockItemId:            itemId,
        quantity:               1,
        serialId:               offBookSerialId,
        consumedFromLocationId: LOC_TECH_ID,
        // no holderId, no consumedById → holder resolves to null
      }),
    ).rejects.toBeInstanceOf(OffBookConsumptionError);

    // Side-effect free: serial untouched, no events, no consumption row.
    const serialRow = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [offBookSerialId],
    );
    expect(serialRow.rows[0]?.status).toBe('issued');

    const events = await pool.query(
      `SELECT 1 FROM stock_serial_events WHERE serial_id = $1`,
      [offBookSerialId],
    );
    expect(events.rows).toHaveLength(0);

    const consumptions = await pool.query(
      `SELECT 1 FROM stock_consumptions WHERE serial_id = $1`,
      [offBookSerialId],
    );
    expect(consumptions.rows).toHaveLength(0);
  });
});
