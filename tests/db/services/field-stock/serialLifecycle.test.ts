/**
 * tests/db/services/field-stock/serialLifecycle.test.ts
 *
 * Integration tests for promoteSerial(). Requires the Sprint E test container
 * (mig 387 triggers installed) — run via `npm run test:db`.
 *
 * Schema notes (from spec deviations section):
 *   - stock_holders.holder_type is restricted to {staff, contractor, external_person}
 *     by mig 383's CHECK constraint. No 'warehouse' holder type exists.
 *   - in_stock serial: holder_id IS NULL (mig 387 holder-pairs allows NULL for in_stock)
 *   - issued serial: holder_id = staff holder (mig 387 allows 'staff' holder for issued)
 *
 * Trigger ordering note (mig 387):
 *   Both trg_stock_serial_holder_validate_t and trg_stock_serial_status_validate_t
 *   are BEFORE UPDATE triggers. Postgres fires BEFORE triggers in alphabetical order
 *   by trigger name — 'h' before 's', so holder-validate always runs first.
 *   Test 2 uses a serial with holder_id IS NULL (activated allows NULL) so the
 *   holder-validate passes and the status-validate can raise LifecycleViolationError.
 *
 * The staff holder row ('ee000000-...') is seeded by sprint-e-holders-seed.sql.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { promoteSerial, LifecycleViolationError } from '@/modules/procurement/field-stock/services/serialLifecycle';

describe('promoteSerial', () => {
  let pool: Pool;
  // Serial for the happy-path test (in_stock → issued).
  let testSerialId: string;
  // Separate serial for the rejection test — stays at in_stock (holder=NULL)
  // so the holder-validate passes and status-validate raises FF001.
  let rejectionSerialId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

    // Serial 1: in_stock with holder_id = NULL (valid for in_stock per mig 387).
    const r1 = await pool.query(`
      INSERT INTO stock_serials (serial_number, stock_item_id, status)
      VALUES ('TEST-LIFECYCLE-001',
              (SELECT id FROM stock_items WHERE item_code='FT-ONT' LIMIT 1),
              'in_stock')
      RETURNING id`);
    testSerialId = r1.rows[0].id;

    // Serial 2: also in_stock with holder_id = NULL.
    // Used for the rejection test so holder-validate passes (activated allows NULL
    // holder) — allowing status-validate to raise lifecycle_violation (FF001).
    const r2 = await pool.query(`
      INSERT INTO stock_serials (serial_number, stock_item_id, status)
      VALUES ('TEST-LIFECYCLE-002',
              (SELECT id FROM stock_items WHERE item_code='FT-ONT' LIMIT 1),
              'in_stock')
      RETURNING id`);
    rejectionSerialId = r2.rows[0].id;
  });

  afterAll(async () => {
    const ids = [testSerialId, rejectionSerialId].filter(Boolean);
    if (ids.length > 0) {
      await pool.query(
        'DELETE FROM stock_serial_events WHERE serial_id = ANY($1::uuid[])',
        [ids],
      );
      await pool.query(
        'DELETE FROM stock_serials WHERE id = ANY($1::uuid[])',
        [ids],
      );
    }
    await pool.end();
  });

  it('promotes in_stock → issued and emits an event with the supplied context', async () => {
    // The staff holder row is seeded in sprint-e-holders-seed.sql with a fixed UUID.
    const techHolderId = 'ee000000-0000-0000-0000-000000000001';

    await promoteSerial(pool, {
      serialId:   testSerialId,
      toStatus:   'issued',
      toHolderId: techHolderId,
      sourceTable: 'stock_pickings',
      sourceId:    '22222222-2222-2222-2222-222222222222',
    });

    const event = await pool.query(
      `SELECT event_type, from_state, to_state, source_table
         FROM stock_serial_events
        WHERE serial_id = $1
        ORDER BY occurred_at DESC
        LIMIT 1`,
      [testSerialId],
    );

    expect(event.rows[0]).toEqual({
      event_type:   'issued_to_tech',
      from_state:   'in_stock',
      to_state:     'issued',
      source_table: 'stock_pickings',
    });
  });

  it('rejects illegal transition with LifecycleViolationError', async () => {
    // in_stock → scrapped is illegal (scrap only via faulty/returned disposition).
    // (in_stock → activated is legal post-mig-393 OES reconciliation, so it can
    // no longer serve as the illegal example.) The serial has holder_id = NULL:
    //   - holder-validate: ('scrapped', NULL) IS allowed → passes
    //   - status-validate: ('in_stock', 'scrapped') NOT in matrix → raises FF001
    // This isolates the status-validate trigger (lifecycle_violation path).
    await expect(
      promoteSerial(pool, {
        serialId:    rejectionSerialId,
        toStatus:    'scrapped',
        sourceTable: 'oes_pp_data',
        sourceId:    '33333333-3333-3333-3333-333333333333',
      }),
    ).rejects.toThrow(LifecycleViolationError);
  });
});
