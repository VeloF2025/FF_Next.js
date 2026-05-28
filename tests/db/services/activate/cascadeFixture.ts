/**
 * cascadeFixture.ts — Sprint E Track 2.4 test fixture helper
 *
 * Extracted from cascadePpResolution.lifecycle.test.ts to stay under the
 * 300-line CLAUDE.md ceiling. Handles schema DDL, seeding, and mig 364
 * TRIGGER 3 cleanup so the test file focuses on assertions.
 */

import { Pool } from 'pg';

// ─── Shared constants ─────────────────────────────────────────────────────────

/** Prefix-scoped so afterAll DELETE is safe. */
export const SN_PREFIX = 'TRACK2-CASCADE-';

/** Phantom suffix — mig 367 trigger skips unknown serials; isolates test rows. */
export const PHANTOM_SERIAL_SUFFIX = '-PHANTOM-MIG367';

/** Fixed drop numbers — one per test serial to prevent cross-contamination. */
export const DROP_ACTIVATED = 'TC24-DROP-ACTIVATED';
export const DROP_INSTALLED = 'TC24-DROP-INSTALLED';
export const DROP_INSTOCK   = 'TC24-DROP-INSTOCK';
export const DROP_ISSUED    = 'TC24-DROP-ISSUED';

// ─── Types ────────────────────────────────────────────────────────────────────

/** All IDs and constants returned by setupCascadeFixture. */
export interface CascadeFixtureHandle {
  itemId: string;
  activatedSerialId: string;
  installedSerialId: string;
  inStockSerialId:   string;
  issuedSerialId:    string;
  /** Drop numbers so test cases can assert `installed_at_drop_number`. */
  DROP_ACTIVATED: string;
  DROP_INSTALLED: string;
  DROP_INSTOCK:   string;
  DROP_ISSUED:    string;
}

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Set up all DDL, seed data, and mig 364 TRIGGER 3 cleanup for the cascade
 * lifecycle tests. Designed to run in `beforeAll`.
 *
 * Returns a handle with all seeded IDs + the shared drop number constants so
 * test cases can reference them without module-level mutable variables.
 *
 * @param pool  The test pg.Pool (TEST_DATABASE_URL).
 */
export async function setupCascadeFixture(
  pool: Pool,
): Promise<CascadeFixtureHandle> {
  // Fixed seed reference from tests/db/setup/seed.sql
  const LOC_WAREHOUSE_ID = '10000000-0000-0000-0000-000000000001'; // WAREHOUSE-001

  // 1. Extend oes_pp_data with columns used by the cascade SELECT (idempotent).
  await pool.query(`ALTER TABLE oes_pp_data
    ADD COLUMN IF NOT EXISTS resolved_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_drop_number  TEXT,
    ADD COLUMN IF NOT EXISTS resolved_details      JSONB,
    ADD COLUMN IF NOT EXISTS maintenance_ticket_id UUID,
    ADD COLUMN IF NOT EXISTS project               TEXT,
    ADD COLUMN IF NOT EXISTS resolved_source       TEXT`);

  // 2. Extend drops with updated_at (the cascade does SET updated_at = NOW()).
  await pool.query(`ALTER TABLE drops ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);

  // 3. Stub maintenance tables — table references must resolve even when
  //    maintenance_ticket_id IS NULL. Minimal columns suffice.
  await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT,
    dr_number TEXT, ont_serial TEXT, resolved_at TIMESTAMPTZ,
    resolution_path TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id UUID,
    content TEXT, note_type TEXT, visibility TEXT,
    is_resolution BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS maintenance_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), ticket_id UUID,
    activity_type TEXT, description TEXT, field_changes JSONB,
    created_by_name TEXT, created_by_email TEXT, source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // 4. Insert four dedicated drop rows — one per test serial — to prevent the
  //    mig 367 drops trigger from emitting cross-contaminating events.
  for (const dn of [DROP_ACTIVATED, DROP_INSTALLED, DROP_INSTOCK, DROP_ISSUED]) {
    await pool.query(
      `INSERT INTO drops (drop_number) VALUES ($1) ON CONFLICT (drop_number) DO NOTHING`,
      [dn],
    );
  }

  // 5. Stock item (generic — no ONT-specific side effects).
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK2-CASCADE-GENERIC', 'TRACK2 Cascade Test Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const itemId = itemRes.rows[0].id;

  // 6. Seed four serials in non-standard initial states using bypass=true.
  //    activated and installed require bypass because they are not reachable
  //    from __new__ via the matrix.
  let activatedSerialId: string;
  let installedSerialId: string;
  let inStockSerialId:   string;
  let issuedSerialId:    string;

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

  // 7. Seed oes_pp_data rows — one per serial, each with its own drop.
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
  //    We clean up both side-effects after the insert so the test starts from
  //    the intended clean state. This is a deliberate test posture: we are
  //    testing the CASCADE's contract in isolation, not the joint behaviour with
  //    TRIGGER 3. See cascadePpResolution.ts inline doc for full background.
  await pool.query(
    `
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
    `,
    [
      `${SN_PREFIX}ACTIVATED-001`,  // $1
      DROP_ACTIVATED,                // $2
      `${SN_PREFIX}INSTALLED-001`,  // $3
      DROP_INSTALLED,                // $4
      `${SN_PREFIX}INSTOCK-001`,    // $5
      PHANTOM_SERIAL_SUFFIX,         // $6 (appended to serial → phantom photo_serial)
      DROP_INSTOCK,                  // $7
      `${SN_PREFIX}ISSUED-001`,     // $8
      DROP_ISSUED,                   // $9
    ],
  );

  // 8. Clean up mig 364 TRIGGER 3 side-effects from the oes_pp_data INSERT:
  //    (a) Delete all events emitted during the PP insert for our serials.
  //    (b) Re-set serials back to their intended seed state.
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN ($1, $2, $3, $4)`,
    [activatedSerialId, installedSerialId, inStockSerialId, issuedSerialId],
  );

  // Restore `installed` + `issued` serials: mig 364 TRIGGER 3 changed them
  // to 'activated'. Use bypass=true to restore the intended states.
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

  // 9. Delete any events from the restore UPDATEs (mig 387 status emit fires).
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN ($1, $2, $3, $4)`,
    [activatedSerialId, installedSerialId, inStockSerialId, issuedSerialId],
  );

  return {
    itemId,
    activatedSerialId,
    installedSerialId,
    inStockSerialId,
    issuedSerialId,
    DROP_ACTIVATED,
    DROP_INSTALLED,
    DROP_INSTOCK,
    DROP_ISSUED,
  };
}
