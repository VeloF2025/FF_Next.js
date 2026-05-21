/**
 * tests/db/triggers/_helpers.ts
 *
 * Shared seed-IDs, location-IDs, and resetState() for trigger tests.
 * The trigger test suite is split across multiple files (picking, returns,
 * other) to keep each file under the 300-line hard limit.
 */
import type { Pool } from 'pg';

// Known UUIDs from seed.sql
export const SERIAL_ID_1   = '77777777-7777-7777-7777-777777777777'; // available
export const SERIAL_ID_2   = '88888888-8888-8888-8888-888888888888'; // issued
export const DROP_ID       = '44444444-4444-4444-4444-444444444444';
export const STAFF_ID      = '33333333-3333-3333-3333-333333333333';
export const STOCK_ITEM_ID = '55555555-5555-5555-5555-555555555555';
export const SOURCE_LOC    = '10000000-0000-0000-0000-000000000001'; // warehouse
export const DEST_LOC      = '10000000-0000-0000-0000-000000000002'; // tech truck
export const SEED_PICK_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

export async function clearEvents(pool: Pool): Promise<void> {
  await pool.query(
    `DELETE FROM stock_serial_events WHERE serial_id IN ($1,$2)`,
    [SERIAL_ID_1, SERIAL_ID_2],
  );
}

/**
 * Reset state for the two seed serials and remove any test-inserted rows.
 * Must be called at the START of each test AND in every finally block.
 *
 * Preserves the seed qa_photo_reviews row for ALCL12345002 (Backfill B tests
 * depend on it). Test inserts of qa_photo_reviews target ALCL12345001 or use
 * known UNKNOWN-* sentinels.
 */
export async function resetState(pool: Pool): Promise<void> {
  // Reset serial_1 to 'available'.
  await pool.query(`
    UPDATE stock_serials
    SET    status = 'available', installed_at_drop_id = NULL,
           activated_at_olt_id = NULL,
           updated_at = NOW()
    WHERE  id = $1`, [SERIAL_ID_1]);
  // Reset serial_2 to 'issued'.
  await pool.query(`
    UPDATE stock_serials
    SET    status = 'issued', installed_at_drop_id = NULL,
           activated_at_olt_id = NULL,
           updated_at = NOW()
    WHERE  id = $1`, [SERIAL_ID_2]);
  // Clean up test-inserted oes_pp_data rows.
  await pool.query(`DELETE FROM oes_pp_data`);
  // Delete qa_photo_reviews rows targeting the test-only serials (preserve seed).
  // Prod schema correction (PR-7): column is ont_serial_scanned, not ont_serial.
  await pool.query(
    `DELETE FROM qa_photo_reviews
     WHERE ont_serial_scanned IN ('ALCL12345001', 'UNKNOWN-SERIAL-XYZ')`);
  // Remove test-inserted return lines + returns.
  await pool.query(
    `DELETE FROM stock_return_lines WHERE serial_id IN ($1,$2)`,
    [SERIAL_ID_1, SERIAL_ID_2],
  );
  await pool.query(`
    DELETE FROM stock_returns
    WHERE id NOT IN (SELECT '00000000-0000-0000-0000-000000000000'::uuid)
      AND returned_by_id = $1`, [STAFF_ID]);
  // Remove test-inserted pickings (preserve the seed bbbb picking).
  await pool.query(`
    DELETE FROM stock_picking_lines spl
    USING  stock_pickings sp
    WHERE  spl.picking_id = sp.id
      AND  sp.id <> $1
      AND  ($2::uuid = ANY(spl.serial_ids) OR $3::uuid = ANY(spl.serial_ids))`,
    [SEED_PICK_ID, SERIAL_ID_1, SERIAL_ID_2]);
  await pool.query(`
    DELETE FROM stock_pickings
    WHERE  id <> $1 AND technician_id = $2`, [SEED_PICK_ID, STAFF_ID]);
  await pool.query(`DELETE FROM contractor_stock_accountability`);
  await clearEvents(pool);
}

let counter = 0;
export function uniquePickingNumber(): string {
  counter += 1;
  return `PICK-TEST-${Date.now()}-${counter}`;
}
export function uniqueReturnNumber(): string {
  counter += 1;
  return `RET-TEST-${Date.now()}-${counter}`;
}
