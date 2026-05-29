/**
 * tests/db/services/field-stock/consumptionService.lifecycle.test.ts
 *
 * Integration tests for recordConsumption's serial lifecycle behaviour:
 *   - Task 2.1: the install status write routes through promoteSerial (emits
 *     exactly one stock_serial_events row, source_table='stock_consumptions').
 *   - Track 4.3 (SOP-4.4): a serialised consumption with no resolvable holder
 *     is rejected with OffBookConsumptionError BEFORE any write.
 *
 * Requirements for PASS:
 *   - Sprint E container (mig 387 triggers installed via vitest.db.sprinte.config.ts)
 *   - stock_consumptions with full prod-schema columns (extended sprint-e-seed.sql)
 *   - A seeded staff holder (sprint-e-holders-seed.sql, staff_id 33333333…)
 *
 * Isolation: uses TRACK43-CONS- prefixed serial numbers; afterAll cleans up
 * stock_serial_events, stock_consumptions, field_stock_movements and stock_serials.
 *
 * Design choices:
 * - No `serialNumber` in inputs → skips `validateSerialForConsumption`
 *   (service guard: `if (input.serialId && input.serialNumber)`). The serial
 *   service queries prod-only columns (s.imei, etc.) not present in the sprint-e
 *   seed schema. The install step fires on `serialId + dropId + dropNumber`, and
 *   the off-book guard fires on `serialId + null-holder` — both independent of it.
 *
 * - The SUCCESS path carries a holder (`consumedById` resolves to the seeded
 *   staff holder), which exercises the custody debit (step 4). The debit writes
 *   field_stock_movements with `reference`/`performed_by`/`performed_at` — prod
 *   columns absent from the older sprint-e-seed ledger schema — so beforeAll adds
 *   them idempotently. `stock_custody` already exists (created by mig 384). The
 *   custody arithmetic (`COALESCE($cost,0) * $qty`) is numeric-cast (#1831 fix),
 *   so the debit no longer fails 42P08 against numeric columns.
 *
 * - Stock item code 'TRACK43-GENERIC' does NOT match 'ont'/'ups'/'gizzu'/'router'
 *   → buildDropSerialUpdate returns `SELECT 1` (no-op), so drops.ont_serial is
 *   never updated and the mig 367 drops trigger does NOT fire. This guarantees
 *   the only stock_serial_events row can come from promoteSerial.
 *
 * - Seeding in 'issued' state: ('__new__', 'issued') is not in the transition
 *   matrix, so the validate trigger would reject a direct INSERT. We use
 *   bypass=true for the seed INSERT, then delete the seed event so each
 *   per-serial event assertion starts from a clean slate.
 *
 * Config: vitest.db.sprinte.config.ts (Sprint E Docker + mig 387)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool }              from 'pg';
import {
  recordConsumption,
  OffBookConsumptionError,
} from '@/modules/procurement/field-stock/services/consumptionService';

// ─── Fixed seed references (from tests/db/setup/seed.sql + holders-seed.sql) ──
const LOC_TECH_ID     = '10000000-0000-0000-0000-000000000002'; // TECH-001
const DROP_ID         = '44444444-4444-4444-4444-444444444444'; // DR0000001
const DROP_NUMBER     = 'DR0000001';
const HOLDER_STAFF_ID = '33333333-3333-3333-3333-333333333333'; // resolves to the seeded staff holder

/** Prefix-scoped so afterAll DELETE is safe and won't touch unrelated rows. */
const SN_PREFIX = 'TRACK43-CONS-';

// ─── Module-level pool (global setup points TEST_DATABASE_URL at Docker) ─────
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let itemId:          string;
let serialId:        string; // success-path serial (gets installed)
let offBookSerialId: string; // negative-path serial (must stay untouched)

/** Seed a serial in 'issued' via bypass, then strip the auto-emitted event. */
async function seedIssuedSerial(serialNumber: string): Promise<string> {
  const seedClient = await pool.connect();
  let id: string;
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const res = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'issued', $3)
       RETURNING id`,
      [serialNumber, itemId, LOC_TECH_ID],
    );
    await seedClient.query('COMMIT');
    id = res.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }
  // The mig 387 emit trigger fires even during bypass inserts; delete the
  // resulting event so the per-serial event assertion starts from zero.
  await pool.query(`DELETE FROM stock_serial_events WHERE serial_id = $1`, [id]);
  return id;
}

// ─── beforeAll: seed stock_item + two serials in 'issued' state ──────────────
beforeAll(async () => {
  // Stock item with generic code — ensures buildDropSerialUpdate is a no-op.
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK43-GENERIC', 'TRACK43 Generic Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  itemId = itemRes.rows[0].id;

  // Add the prod consumption-movement columns the older sprint-e-seed ledger
  // schema lacks (idempotent). The custody debit on the success path writes
  // these via SQL_MOVEMENT_CONSUMPTION. stock_custody itself is created by mig 384.
  await pool.query(
    `ALTER TABLE field_stock_movements
       ADD COLUMN IF NOT EXISTS reference    text,
       ADD COLUMN IF NOT EXISTS performed_by varchar(255),
       ADD COLUMN IF NOT EXISTS performed_at timestamptz`,
  );

  serialId        = await seedIssuedSerial(`${SN_PREFIX}INSTALL-001`);
  offBookSerialId = await seedIssuedSerial(`${SN_PREFIX}OFFBOOK-001`);
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
    // field_stock_movements references stock_items(id) → must clear before the
    // stock_items delete below or the FK blocks it.
    await pool.query(
      `DELETE FROM field_stock_movements WHERE stock_item_id = $1`,
      [itemId],
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
   * fire here because TRACK43-GENERIC bypasses all branches in buildDropSerialUpdate.
   */
  it('emits exactly one stock_serial_events row via promoteSerial with source_table=stock_consumptions', async () => {
    // serialId + dropId + dropNumber → install branch fires.
    // consumedById resolves to the seeded staff holder so the Track-4.3 off-book
    // guard passes and the custody debit (step 4) runs.
    const result = await recordConsumption({
      jobType:                'drop',
      dropId:                 DROP_ID,
      dropNumber:             DROP_NUMBER,
      stockItemId:            itemId,
      quantity:               1,
      serialId:               serialId,
      consumedById:           HOLDER_STAFF_ID,
      consumedByName:         'Test Tech Holder',
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

    // Assertion 4: the custody debit posted a consumption movement for the holder
    // (proves the #1831 numeric-cast lets the holder path complete end-to-end).
    const movements = await pool.query(
      `SELECT 1 FROM field_stock_movements
        WHERE stock_item_id = $1 AND movement_type = 'consumption'`,
      [itemId],
    );
    expect(movements.rows).toHaveLength(1);
  });
});

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
