/**
 * tests/db/services/activate/cascadePpResolution.lifecycle.test.ts
 *
 * Integration test for Task 2.4: confirms that cascadePpResolution routes
 * serial status writes through promoteSerial (metadata + event) instead of
 * a single bulk UPDATE.
 *
 * Requirements for PASS:
 *   - Sprint E container (mig 387 triggers installed via vitest.db.sprinte.config.ts)
 *
 * Test cases (per plan specification):
 *   1. `activated` serial: cascade updates metadata (installed_at_drop_number)
 *      but DOES NOT change status or emit a stock_serial_events row.
 *   2. `installed` serial: same metadata-only behaviour as `activated`.
 *   3. `in_stock` serial: promoted via promoteSerial → status='installed' +
 *      exactly one event row (event_type='installed_at_drop', source='oes_pp_data').
 *   4. `issued` serial: same promotion behaviour as `in_stock` (regression
 *      coverage for the pre-existing matrix row).
 *
 * Isolation:
 *   - TRACK2-CASCADE- prefixed serial numbers; afterAll cleans up.
 *   - FAKE_PP_ID '4' maps to uuid '00000000-0000-0000-0000-000000000004'
 *     (ppIdToUuid encoding in cascadeSerialPromotion.ts).
 *   - PP rows seeded with resolved_at in the future of cutoffTime so the
 *     cascade's WHERE clause picks them up.
 *
 * Schema notes:
 *   - oes_pp_data test schema (seed.sql) only has id, serial_number, olt_name,
 *     olt_pon, resolution_status, created_at. We ADD columns needed by the
 *     cascade in beforeAll (IF NOT EXISTS — idempotent on re-run).
 *   - drops test schema has no updated_at column; we ADD it in beforeAll.
 *   - maintenance_ticket_id is NULL in all test PP rows so the ticket/note/
 *     activity cascade sections are no-ops (they filter on ticket_id IS NOT NULL).
 *
 * Config: vitest.db.sprinte.config.ts (Sprint E Docker + mig 387)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { cascadePpResolution } from '@/modules/activate/services/cascadePpResolution';

// ─── Fixed seed references (from tests/db/setup/seed.sql) ────────────────────
const LOC_WAREHOUSE_ID = '10000000-0000-0000-0000-000000000001'; // WAREHOUSE-001

// Each serial gets its own drop to prevent the mig 367 drops trigger from
// emitting cross-contaminating events. Drop numbers are unique and test-scoped.
const DROP_ACTIVATED = 'TC24-DROP-ACTIVATED';
const DROP_INSTALLED = 'TC24-DROP-INSTALLED';
const DROP_INSTOCK   = 'TC24-DROP-INSTOCK';
const DROP_ISSUED    = 'TC24-DROP-ISSUED';

// A phantom photo_serial (not in stock_serials) is injected into resolved_details
// so that the drops UPDATE sets drops.ont_serial to this phantom value. The mig
// 367 drops trigger then looks up the phantom serial, finds nothing, and skips
// the event + status write. Without this, mig 367 would race the cascade and emit
// source_table='drops' events that corrupt the assertions.
const PHANTOM_SERIAL_SUFFIX = '-PHANTOM-MIG367';

/** Prefix-scoped so afterAll DELETE is safe. */
const SN_PREFIX = 'TRACK2-CASCADE-';

/**
 * FAKE_PP_ID base: oes_pp_data rows get IDs assigned by SERIAL.
 * We INSERT four PP rows and rely on afterAll cleanup; exact IDs are read
 * back from INSERT … RETURNING id so we don't assume sequence values.
 */

// ─── Module-level pool ────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let itemId: string;

// serial IDs keyed by test case name
let activatedSerialId: string;
let installedSerialId: string;
let inStockSerialId:   string;
let issuedSerialId:    string;

// cutoffTime: set BEFORE seeding resolved PPs so all test PP rows are after it.
let cutoffTime: Date;

// ─── beforeAll: extend schema, seed stock_item + serials + pp rows ────────────
beforeAll(async () => {
  // 1. Extend oes_pp_data with columns used by the cascade SELECT.
  //    IF NOT EXISTS makes this idempotent on re-runs without teardown.
  await pool.query(`
    ALTER TABLE oes_pp_data
      ADD COLUMN IF NOT EXISTS resolved_at           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS resolved_drop_number  TEXT,
      ADD COLUMN IF NOT EXISTS resolved_details      JSONB,
      ADD COLUMN IF NOT EXISTS maintenance_ticket_id UUID,
      ADD COLUMN IF NOT EXISTS project               TEXT,
      ADD COLUMN IF NOT EXISTS resolved_source       TEXT
  `);

  // 2. Extend drops with updated_at (the cascade does SET updated_at = NOW()).
  await pool.query(`
    ALTER TABLE drops
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
  `);

  // 3. Stub maintenance tables — the cascade queries these tables even when
  //    maintenance_ticket_id IS NULL (the WHERE clause prevents row updates,
  //    but the table reference still must resolve). Minimal columns suffice.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status          TEXT,
      dr_number       TEXT,
      ont_serial      TEXT,
      resolved_at     TIMESTAMPTZ,
      resolution_path TEXT,
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_notes (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id    UUID,
      content      TEXT,
      note_type    TEXT,
      visibility   TEXT,
      is_resolution BOOLEAN DEFAULT false,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_activities (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id        UUID,
      activity_type    TEXT,
      description      TEXT,
      field_changes    JSONB,
      created_by_name  TEXT,
      created_by_email TEXT,
      source           TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // 3. Insert four dedicated drop rows — one per test serial — to prevent
  //    the mig 367 drops trigger from seeing multiple serials on the same drop
  //    and emitting cross-contaminating events.
  for (const dn of [DROP_ACTIVATED, DROP_INSTALLED, DROP_INSTOCK, DROP_ISSUED]) {
    await pool.query(
      `INSERT INTO drops (drop_number) VALUES ($1) ON CONFLICT (drop_number) DO NOTHING`,
      [dn],
    );
  }

  // 4. Stock item (generic — no ONT-specific side effects).
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK2-CASCADE-GENERIC', 'TRACK2 Cascade Test Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  itemId = itemRes.rows[0].id;

  // 5. Seed four serials in non-standard initial states using bypass=true.
  //    activated and installed require bypass because they are not reachable
  //    from __new__ via the matrix.
  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);

    const activatedRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'activated', $3) RETURNING id`,
      [`${SN_PREFIX}ACTIVATED-001`, itemId, LOC_WAREHOUSE_ID],
    );
    const installedRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'installed', $3) RETURNING id`,
      [`${SN_PREFIX}INSTALLED-001`, itemId, LOC_WAREHOUSE_ID],
    );
    const inStockRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'in_stock', $3) RETURNING id`,
      [`${SN_PREFIX}INSTOCK-001`, itemId, LOC_WAREHOUSE_ID],
    );
    const issuedRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'issued', $3) RETURNING id`,
      [`${SN_PREFIX}ISSUED-001`, itemId, LOC_WAREHOUSE_ID],
    );

    await seedClient.query('COMMIT');
    activatedSerialId = activatedRes.rows[0].id;
    installedSerialId = installedRes.rows[0].id;
    inStockSerialId   = inStockRes.rows[0].id;
    issuedSerialId    = issuedRes.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }

  // 6. Capture cutoffTime BEFORE seeding the PP rows (so all resolved_at values
  //    are strictly AFTER cutoffTime, satisfying WHERE pp.resolved_at >= $1).
  cutoffTime = new Date();
  // Small pause so NOW() in PP inserts is strictly after cutoffTime.
  await new Promise((r) => setTimeout(r, 20));

  // 8. Seed oes_pp_data rows — one per serial, each with its own drop.
  //    maintenance_ticket_id = NULL → ticket/note/activity sections are no-ops.
  //
  //    photo_serial is set to a phantom value (not in stock_serials) so that
  //    the cascade's drops UPDATE (SET ont_serial = photo_serial) causes the
  //    mig 367 drops trigger to fire on a non-existent serial — it logs a
  //    NOTICE and skips the event + status write, isolating our test serials
  //    from any mig 367 side-effects.
  //
  //    IMPORTANT: mig 364 TRIGGER 3 fires on oes_pp_data INSERT and:
  //      (a) emits an 'activated' event for the serial
  //      (b) directly UPDATEs status → 'activated' when source status is
  //          'available', 'installed', or 'issued'
  //    We must clean up both side-effects after the insert so the test starts
  //    from the intended clean state.
  await pool.query(`
    INSERT INTO oes_pp_data
      (serial_number, resolution_status, resolved_at, resolved_drop_number,
       resolved_details, maintenance_ticket_id, project, resolved_source)
    VALUES
      ($1, 'located_oes', NOW(), $2,
       jsonb_build_object('photo_serial', $1 || $6), NULL, 'TEST-PROJECT', 'test'),
      ($3, 'located_oes', NOW(), $4,
       jsonb_build_object('photo_serial', $3 || $6), NULL, 'TEST-PROJECT', 'test'),
      ($5, 'located_oes', NOW(), $7,
       jsonb_build_object('photo_serial', $5 || $6), NULL, 'TEST-PROJECT', 'test'),
      ($8, 'located_oes', NOW(), $9,
       jsonb_build_object('photo_serial', $8 || $6), NULL, 'TEST-PROJECT', 'test')
  `, [
    `${SN_PREFIX}ACTIVATED-001`,  // $1
    DROP_ACTIVATED,                // $2
    `${SN_PREFIX}INSTALLED-001`,  // $3
    DROP_INSTALLED,                // $4
    `${SN_PREFIX}INSTOCK-001`,    // $5
    PHANTOM_SERIAL_SUFFIX,         // $6 (appended to serial → phantom photo_serial)
    DROP_INSTOCK,                  // $7
    `${SN_PREFIX}ISSUED-001`,     // $8
    DROP_ISSUED,                   // $9
  ]);

  // 9. Clean up mig 364 TRIGGER 3 side-effects from the oes_pp_data INSERT:
  //    (a) Delete all events emitted during the PP insert for our serials.
  //    (b) Re-set the `installed` serial back to 'installed' — the trigger
  //        directly UPDATEs stock_serials.status → 'activated' when it finds
  //        status='installed'. Use bypass=true to restore the intended state.
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN ($1, $2, $3, $4)`,
    [activatedSerialId, installedSerialId, inStockSerialId, issuedSerialId],
  );

  // Restore `installed` serial: the mig 364 trigger changed it to 'activated'.
  // Also restore `issued` serial if the trigger changed it (it does for 'issued').
  const restoreClient = await pool.connect();
  try {
    await restoreClient.query('BEGIN');
    await restoreClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    await restoreClient.query(
      `UPDATE stock_serials SET status = 'installed', updated_at = NOW() WHERE id = $1`,
      [installedSerialId],
    );
    await restoreClient.query(
      `UPDATE stock_serials SET status = 'issued', updated_at = NOW() WHERE id = $1`,
      [issuedSerialId],
    );
    await restoreClient.query('COMMIT');
  } catch (err) {
    await restoreClient.query('ROLLBACK');
    throw err;
  } finally {
    restoreClient.release();
  }

  // 10. Delete any events from the restore UPDATEs (mig 387 status emit fires).
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN ($1, $2, $3, $4)`,
    [activatedSerialId, installedSerialId, inStockSerialId, issuedSerialId],
  );
});

// ─── afterAll: remove seeded rows in FK-safe order ───────────────────────────
afterAll(async () => {
  try {
    // Remove PP rows
    await pool.query(
      `DELETE FROM oes_pp_data
        WHERE serial_number LIKE $1`,
      [`${SN_PREFIX}%`],
    );
    // Remove test drops (four dedicated ones)
    await pool.query(
      `DELETE FROM drops WHERE drop_number = ANY($1::text[])`,
      [[DROP_ACTIVATED, DROP_INSTALLED, DROP_INSTOCK, DROP_ISSUED]],
    );
    // Remove events + serials
    await pool.query(
      `DELETE FROM stock_serial_events
        WHERE serial_id IN (
          SELECT id FROM stock_serials WHERE serial_number LIKE $1
        )`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM stock_serials WHERE serial_number LIKE $1`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM stock_items WHERE item_code = 'TRACK2-CASCADE-GENERIC'`,
    );
  } finally {
    await pool.end();
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('cascadePpResolution — serial lifecycle via promoteSerial (Task 2.4)', () => {
  /**
   * Run cascade once; subsequent per-test assertions are stateful reads.
   * The cascade is idempotent: once installed_at_drop_number is set the
   * WHERE clause excludes the row, so a double-run would produce no changes.
   *
   * We run it in a `it` block with `beforeAll`-style ordering by relying on
   * Vitest's sequential execution (threads: false in config).
   *
   * The actual cascade call is placed INSIDE the first `it` so we can assert
   * on its return value. Subsequent `it`s read the DB state after it ran.
   */

  it('case 1 — activated serial: metadata updated, status unchanged, zero events', async () => {
    // Run cascade (affects all four serials).
    await cascadePpResolution(cutoffTime);

    // Assertions for the `activated` serial.
    const row = await pool.query<{
      status: string;
      installed_at_drop_number: string | null;
    }>(
      `SELECT status, installed_at_drop_number
         FROM stock_serials WHERE id = $1`,
      [activatedSerialId],
    );
    expect(row.rows[0]?.status).toBe('activated');
    expect(row.rows[0]?.installed_at_drop_number).toBe(DROP_ACTIVATED);

    const events = await pool.query(
      `SELECT * FROM stock_serial_events WHERE serial_id = $1`,
      [activatedSerialId],
    );
    expect(events.rows).toHaveLength(0);
  });

  it('case 2 — installed serial: metadata updated, status unchanged, zero events', async () => {
    const row = await pool.query<{
      status: string;
      installed_at_drop_number: string | null;
    }>(
      `SELECT status, installed_at_drop_number
         FROM stock_serials WHERE id = $1`,
      [installedSerialId],
    );
    expect(row.rows[0]?.status).toBe('installed');
    expect(row.rows[0]?.installed_at_drop_number).toBe(DROP_INSTALLED);

    const events = await pool.query(
      `SELECT * FROM stock_serial_events WHERE serial_id = $1`,
      [installedSerialId],
    );
    expect(events.rows).toHaveLength(0);
  });

  it('case 3 — in_stock serial: promoted to installed with one audit event', async () => {
    const row = await pool.query<{
      status: string;
      installed_at_drop_number: string | null;
    }>(
      `SELECT status, installed_at_drop_number
         FROM stock_serials WHERE id = $1`,
      [inStockSerialId],
    );
    expect(row.rows[0]?.status).toBe('installed');
    expect(row.rows[0]?.installed_at_drop_number).toBe(DROP_INSTOCK);

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
      [inStockSerialId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toEqual({
      event_type:   'installed_at_drop',
      from_state:   'in_stock',
      to_state:     'installed',
      source_table: 'oes_pp_data',
    });
  });

  it('case 4 — issued serial: promoted to installed with one audit event', async () => {
    const row = await pool.query<{
      status: string;
      installed_at_drop_number: string | null;
    }>(
      `SELECT status, installed_at_drop_number
         FROM stock_serials WHERE id = $1`,
      [issuedSerialId],
    );
    expect(row.rows[0]?.status).toBe('installed');
    expect(row.rows[0]?.installed_at_drop_number).toBe(DROP_ISSUED);

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
      [issuedSerialId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toEqual({
      event_type:   'installed_at_drop',
      from_state:   'issued',
      to_state:     'installed',
      source_table: 'oes_pp_data',
    });
  });
});
