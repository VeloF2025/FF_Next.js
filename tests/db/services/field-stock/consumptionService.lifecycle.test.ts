/**
 * tests/db/services/field-stock/consumptionService.lifecycle.test.ts
 *
 * Integration test for Task 2.1: confirms that recordConsumption routes the
 * serial install status write through promoteSerial instead of a direct UPDATE.
 *
 * Requirements for PASS:
 *   - Sprint E container (mig 387 triggers installed via vitest.db.sprinte.config.ts)
 *   - stock_consumptions with full prod-schema columns (extended sprint-e-seed.sql)
 *
 * Isolation: uses TRACK2-CONS- prefixed serial numbers; afterAll cleans up both
 * stock_serial_events and stock_serials rows.
 *
 * Design choices:
 * - No `serialNumber` in the test input → skips `validateSerialForConsumption`
 *   (service guard: `if (input.serialId && input.serialNumber)`). The serial
 *   service queries prod-only columns (s.imei, etc.) not present in the sprint-e
 *   seed schema. The install step fires on `serialId + dropId + dropNumber` which
 *   is independent of the serialNumber validation guard.
 *
 * - No `holderId` or `consumedById` → skips stock_holders lookup and the
 *   custody debit step, keeping fixtures minimal.
 *
 * - Stock item code 'TRACK2-GENERIC' does NOT match 'ont'/'ups'/'gizzu'/'router'
 *   → buildDropSerialUpdate returns `SELECT 1` (no-op), so drops.ont_serial is
 *   never updated and the mig 367 drops trigger does NOT fire. This guarantees
 *   that the only stock_serial_events row can come from promoteSerial.
 *
 * - Seeding in 'issued' state: ('__new__', 'issued') is not in the transition
 *   matrix, so the validate trigger would reject a direct INSERT. We use
 *   bypass=true for the seed INSERT, then delete the seed event so the test
 *   assertion can check for exactly ONE event (from promoteSerial in the service).
 *
 * Config: vitest.db.sprinte.config.ts (Sprint E Docker + mig 387)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool }              from 'pg';
import { recordConsumption } from '@/modules/procurement/field-stock/services/consumptionService';

// ─── Fixed seed references (from tests/db/setup/seed.sql) ────────────────────
const LOC_TECH_ID = '10000000-0000-0000-0000-000000000002'; // TECH-001
const DROP_ID     = '44444444-4444-4444-4444-444444444444'; // DR0000001
const DROP_NUMBER = 'DR0000001';

/** Prefix-scoped so afterAll DELETE is safe and won't touch unrelated rows. */
const SN_PREFIX = 'TRACK2-CONS-';

// ─── Module-level pool (global setup points TEST_DATABASE_URL at Docker) ─────
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let itemId:   string;
let serialId: string;

// ─── beforeAll: seed stock_item + serial in 'issued' state ───────────────────
beforeAll(async () => {
  // 1. Stock item with generic code — ensures buildDropSerialUpdate is a no-op.
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK2-GENERIC', 'TRACK2 Generic Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  itemId = itemRes.rows[0].id;

  // 2. Seed the serial in 'issued' status.
  //    ('__new__', 'issued') is not in the transition matrix — only 'in_stock' and
  //    'available' are reachable on INSERT. Use bypass=true to set the required
  //    fixture state without going through a full picking flow.
  //    The mig 387 emit trigger fires even during bypass inserts, so we delete the
  //    resulting event immediately after commit to keep the "exactly one event"
  //    assertion clean.
  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const serialRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'issued', $3)
       RETURNING id`,
      [`${SN_PREFIX}INSTALL-001`, itemId, LOC_TECH_ID],
    );
    await seedClient.query('COMMIT');
    serialId = serialRes.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }

  // 3. Delete the event emitted by the bypass INSERT so the test assertion
  //    starts from a clean slate (exactly zero events before the service call).
  await pool.query(
    `DELETE FROM stock_serial_events WHERE serial_id = $1`,
    [serialId],
  );
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
      `DELETE FROM stock_items WHERE item_code = 'TRACK2-GENERIC'`,
    );
  } finally {
    await pool.end();
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('recordConsumption — serial install lifecycle (Task 2.1)', () => {
  /**
   * Core assertion: after recordConsumption processes a serialised install,
   * exactly one stock_serial_events row must exist with:
   *   event_type   = 'installed_at_drop'
   *   from_state   = 'issued'
   *   to_state     = 'installed'
   *   source_table = 'stock_consumptions'
   *
   * The source_table value is the discriminator proving the event was emitted
   * by the mig 387 trigger (via promoteSerial), not by the legacy mig 367 drops
   * trigger (which would emit source_table='drops'). The drops trigger cannot
   * fire here because TRACK2-GENERIC bypasses all branches in buildDropSerialUpdate.
   */
  it('emits exactly one stock_serial_events row via promoteSerial with source_table=stock_consumptions', async () => {
    // No `serialNumber` in input → validateSerialForConsumption is skipped
    // (service guard: `if (input.serialId && input.serialNumber)`).
    // serialId + dropId + dropNumber → install branch fires.
    const result = await recordConsumption({
      jobType:                'drop',
      dropId:                 DROP_ID,
      dropNumber:             DROP_NUMBER,
      stockItemId:            itemId,
      quantity:               1,
      serialId:               serialId,
      consumedFromLocationId: LOC_TECH_ID,
    });

    // Assertion 1: consumption record created with a valid UUID.
    expect(typeof result.id).toBe('string');
    expect(result.id.length).toBeGreaterThan(0);

    // Assertion 2: serial status transitioned to 'installed', holder_id cleared.
    const serialRow = await pool.query<{ status: string; holder_id: string | null }>(
      `SELECT status, holder_id FROM stock_serials WHERE id = $1`,
      [serialId],
    );
    expect(serialRow.rows[0]?.status).toBe('installed');
    expect(serialRow.rows[0]?.holder_id).toBeNull();

    // Assertion 3: exactly ONE stock_serial_events row with the expected shape.
    //   - toHaveLength(1): no duplicate from the mig 367 drops trigger
    //   - source_table='stock_consumptions': proves the promoteSerial path
    const events = await pool.query<{
      event_type:   string;
      from_state:   string;
      to_state:     string;
      source_table: string;
    }>(
      `SELECT event_type, from_state, to_state, source_table
         FROM stock_serial_events
        WHERE serial_id = $1
        ORDER BY occurred_at`,
      [serialId],
    );

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toEqual({
      event_type:   'installed_at_drop',
      from_state:   'issued',
      to_state:     'installed',
      source_table: 'stock_consumptions',
    });
  });
});
