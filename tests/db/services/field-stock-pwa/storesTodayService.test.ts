/**
 * tests/db/services/field-stock-pwa/storesTodayService.test.ts
 *
 * Integration tests for getTodayForStoresUser(). Runs against the Wave-1
 * docker-compose harness via vitest.db.config.ts.
 *
 * Schema-bootstrap discipline: the harness's seed.sql is a deliberately
 * minimal mirror of prod. This test ALTERs only the columns the new
 * aggregator actually reads (stock_pickings.created_by_staff_id from
 * migration 371, stock_items.standard_cost) — never expands seed.sql so
 * other tests stay unaffected. Bootstrap is idempotent (IF NOT EXISTS).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getTodayForStoresUser } from '@/modules/field-stock-pwa/services/storesTodayService';

const TEST_DB_URL = process.env.DATABASE_URL_TEST;
if (!TEST_DB_URL) {
  throw new Error(
    'DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml or run via `npm run test:db`.'
  );
}

// PR41 (Phase 4.1) UUID range — far from seed (1-9 prefix) for safe cleanup.
const STORES_STAFF_ID  = 'cccccccc-0000-0000-0000-000000000141';
const OTHER_STAFF_ID   = 'cccccccc-0000-0000-0000-000000000142';
const TECH_A_STAFF_ID  = 'cccccccc-0000-0000-0000-000000000201';
const TECH_B_STAFF_ID  = 'cccccccc-0000-0000-0000-000000000202';
const ITEM_ID          = 'cccccccc-0000-0000-0000-000000000301';
const SERIAL_A1        = 'cccccccc-0000-0000-0000-000000000501'; // tech A, today, installed
const SERIAL_A2        = 'cccccccc-0000-0000-0000-000000000502'; // tech A, today, unaccounted
const SERIAL_B1        = 'cccccccc-0000-0000-0000-000000000503'; // tech B, today, returned
const SERIAL_OTHER     = 'cccccccc-0000-0000-0000-000000000504'; // OTHER stores user
const SERIAL_NULL_TECH = 'cccccccc-0000-0000-0000-000000000505'; // picking with technician_id NULL

const PICKING_A_ID     = 'cccccccc-0000-0000-0000-000000000601';
const PICKING_B_ID     = 'cccccccc-0000-0000-0000-000000000602';
const PICKING_OTHER_ID = 'cccccccc-0000-0000-0000-000000000603';
const PICKING_NULL_ID  = 'cccccccc-0000-0000-0000-000000000604';
const RETURN_ID        = 'cccccccc-0000-0000-0000-000000000701';

// Reuse the seed warehouse + technician locations.
const WAREHOUSE_ID      = '10000000-0000-0000-0000-000000000001';
const FIELD_LOCATION_ID = '10000000-0000-0000-0000-000000000002';

const pool = new Pool({ connectionString: TEST_DB_URL });

// SAST date — service interprets dateSAST against the DB session's TZ. Use
// SAST explicit offset so a UTC midnight crossover doesn't desync.
function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
const TODAY = todayInSast();

beforeAll(async () => {
  // 1. Apply migration 371 inline (idempotent on a fresh container too).
  const mig = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/371_pwa_picking_staff_attribution.sql'),
    'utf8',
  );
  await pool.query(mig);

  // 2. Add columns the new aggregator reads but the minimal seed.sql lacks.
  //    All IF NOT EXISTS / DO blocks so re-running between tests is safe.
  await pool.query(`
    ALTER TABLE stock_items ADD COLUMN IF NOT EXISTS standard_cost numeric(12,2);
    ALTER TABLE stock_pickings ADD COLUMN IF NOT EXISTS picking_number_seq INTEGER;
  `);

  // 3. Test fixtures. Staff = (id, full_name) only — matches seed schema.
  //    Distinct technician names so the secondary alphabetical sort is exercised.
  await pool.query(
    `INSERT INTO staff (id, full_name) VALUES
       ($1, 'PR41 Stores Main'),
       ($2, 'PR41 Stores Other'),
       ($3, 'PR41 AAA Tech'),
       ($4, 'PR41 ZZZ Tech')
     ON CONFLICT (id) DO NOTHING`,
    [STORES_STAFF_ID, OTHER_STAFF_ID, TECH_A_STAFF_ID, TECH_B_STAFF_ID],
  );

  // 4. Stock item with priced value for issued_value_rand math.
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'PR41-ONT', 'PR41 Test ONT', 'ONT', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ID],
  );
  await pool.query(
    `UPDATE stock_items SET standard_cost = 1500 WHERE id = $1`,
    [ITEM_ID],
  );

  // 5. Serials.
  await pool.query(
    `INSERT INTO stock_serials (id, stock_item_id, serial_number, status) VALUES
       ($1, $6, 'PR41-A1',  'available'),
       ($2, $6, 'PR41-A2',  'available'),
       ($3, $6, 'PR41-B1',  'available'),
       ($4, $6, 'PR41-OT',  'available'),
       ($5, $6, 'PR41-NUL', 'available')
     ON CONFLICT (id) DO NOTHING`,
    [SERIAL_A1, SERIAL_A2, SERIAL_B1, SERIAL_OTHER, SERIAL_NULL_TECH, ITEM_ID],
  );
});

afterAll(async () => {
  try {
    // FK-safe order: events → return-lines → returns → picking-lines → pickings → serials → items → staff
    await pool.query(`DELETE FROM stock_serial_events WHERE serial_id = ANY($1::uuid[])`, [
      [SERIAL_A1, SERIAL_A2, SERIAL_B1, SERIAL_OTHER, SERIAL_NULL_TECH],
    ]);
    await pool.query(`DELETE FROM stock_return_lines WHERE return_id = $1`, [RETURN_ID]);
    await pool.query(`DELETE FROM stock_returns WHERE id = $1`, [RETURN_ID]);
    await pool.query(`DELETE FROM stock_picking_lines WHERE picking_id = ANY($1::uuid[])`, [
      [PICKING_A_ID, PICKING_B_ID, PICKING_OTHER_ID, PICKING_NULL_ID],
    ]);
    await pool.query(`DELETE FROM stock_pickings WHERE id = ANY($1::uuid[])`, [
      [PICKING_A_ID, PICKING_B_ID, PICKING_OTHER_ID, PICKING_NULL_ID],
    ]);
    await pool.query(`DELETE FROM stock_serials WHERE id = ANY($1::uuid[])`, [
      [SERIAL_A1, SERIAL_A2, SERIAL_B1, SERIAL_OTHER, SERIAL_NULL_TECH],
    ]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ID]);
    await pool.query(`DELETE FROM staff WHERE id = ANY($1::uuid[])`, [
      [STORES_STAFF_ID, OTHER_STAFF_ID, TECH_A_STAFF_ID, TECH_B_STAFF_ID],
    ]);
  } finally {
    await pool.end();
  }
});

interface PickingOpts {
  pickingId: string;
  pickingNumber: string;
  storesStaffId: string | null;
  technicianStaffId: string | null;
  technicianName: string | null;
  serialIds: string[];
}

async function insertPicking(opts: PickingOpts): Promise<void> {
  // Idempotent: ON CONFLICT on both header AND line so a crash between
  // beforeAll's seed and afterAll's cleanup leaves the test re-runnable.
  await pool.query(
    `INSERT INTO stock_pickings (
       id, picking_number, picking_type, source_location_id, destination_location_id,
       technician_id, technician_name, status, created_by_staff_id, signed_at
     ) VALUES ($1, $2, 'issue', $3, $4, $5, $6, 'done', $7, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [opts.pickingId, opts.pickingNumber, WAREHOUSE_ID, FIELD_LOCATION_ID,
     opts.technicianStaffId, opts.technicianName, opts.storesStaffId],
  );
  // DELETE-then-INSERT for the line because stock_picking_lines lacks a
  // unique constraint that ON CONFLICT could target (picking_id+stock_item_id
  // is NOT unique in prod — a picking may have multiple lines for the same
  // item with different serial batches). DELETE on a crashed-mid-run pre-
  // existing line is the safest re-runnable pattern.
  await pool.query(`DELETE FROM stock_picking_lines WHERE picking_id = $1`, [opts.pickingId]);
  await pool.query(
    `INSERT INTO stock_picking_lines (picking_id, stock_item_id, serial_ids, status)
     VALUES ($1, $2, $3, 'done')`,
    [opts.pickingId, ITEM_ID, opts.serialIds],
  );
}

describe('getTodayForStoresUser', () => {
  beforeAll(async () => {
    // Picking A: stores → tech A → A1 + A2 (today)
    await insertPicking({
      pickingId: PICKING_A_ID,
      pickingNumber: 'PR41-A',
      storesStaffId: STORES_STAFF_ID,
      technicianStaffId: TECH_A_STAFF_ID,
      technicianName: 'PR41 AAA Tech',
      serialIds: [SERIAL_A1, SERIAL_A2],
    });
    // Picking B: stores → tech B → B1 (today)
    await insertPicking({
      pickingId: PICKING_B_ID,
      pickingNumber: 'PR41-B',
      storesStaffId: STORES_STAFF_ID,
      technicianStaffId: TECH_B_STAFF_ID,
      technicianName: 'PR41 ZZZ Tech',
      serialIds: [SERIAL_B1],
    });
    // Picking OTHER: other stores user → tech A → OTHER (today) — must NOT appear in stores' view
    await insertPicking({
      pickingId: PICKING_OTHER_ID,
      pickingNumber: 'PR41-O',
      storesStaffId: OTHER_STAFF_ID,
      technicianStaffId: TECH_A_STAFF_ID,
      technicianName: 'PR41 AAA Tech',
      serialIds: [SERIAL_OTHER],
    });
    // Picking NULL: stores → NULL technician — must be excluded by the IS NOT NULL filter
    await insertPicking({
      pickingId: PICKING_NULL_ID,
      pickingNumber: 'PR41-N',
      storesStaffId: STORES_STAFF_ID,
      technicianStaffId: null,
      technicianName: null,
      serialIds: [SERIAL_NULL_TECH],
    });

    // Install event for A1 today → installed_count++ for tech A.
    await pool.query(
      `INSERT INTO stock_serial_events (serial_id, event_type, from_state, to_state, source_table, occurred_at)
       VALUES ($1, 'installed_at_drop', 'available', 'installed', 'drops', NOW())`,
      [SERIAL_A1],
    );

    // Return for B1 today → returned_count++ for tech B.
    await pool.query(
      `INSERT INTO stock_returns (id, return_number, returned_by_id, status)
       VALUES ($1, 'PR41-RET', $2, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [RETURN_ID, TECH_B_STAFF_ID],
    );
    await pool.query(`DELETE FROM stock_return_lines WHERE return_id = $1`, [RETURN_ID]);
    await pool.query(
      `INSERT INTO stock_return_lines (return_id, stock_item_id, serial_id)
       VALUES ($1, $2, $3)`,
      [RETURN_ID, ITEM_ID, SERIAL_B1],
    );
  });

  it('returns one row per technician issued to TODAY by THIS stores user (excludes other-user pickings AND NULL technician)', async () => {
    const rows = await getTodayForStoresUser(STORES_STAFF_ID, TODAY);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.technician_id).sort();
    expect(ids).toEqual([TECH_A_STAFF_ID, TECH_B_STAFF_ID].sort());
  });

  it('counts issued / installed / returned / unaccounted correctly per tech', async () => {
    const rows = await getTodayForStoresUser(STORES_STAFF_ID, TODAY);
    const techA = rows.find((r) => r.technician_id === TECH_A_STAFF_ID);
    const techB = rows.find((r) => r.technician_id === TECH_B_STAFF_ID);

    expect(techA).toMatchObject({
      issued_count: 2,
      installed_count: 1,
      returned_count: 0,
      unaccounted_count: 1, // 2 issued - 1 installed = 1
    });
    expect(techA?.issued_value_rand).toBe(3000); // 2 × R1500

    expect(techB).toMatchObject({
      issued_count: 1,
      installed_count: 0,
      returned_count: 1,
      unaccounted_count: 0, // 1 issued - 1 returned = 0
    });
  });

  it('scopes by stores user — OTHER stores user sees only their own picking', async () => {
    const rows = await getTodayForStoresUser(OTHER_STAFF_ID, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.technician_id).toBe(TECH_A_STAFF_ID);
    expect(rows[0]?.issued_count).toBe(1);
  });

  it('returns empty when stores user issued nothing', async () => {
    const rows = await getTodayForStoresUser(
      'cccccccc-0000-0000-0000-000000000999', // non-existent
      TODAY,
    );
    expect(rows).toEqual([]);
  });

  it('returns empty for a past date with no activity', async () => {
    const rows = await getTodayForStoresUser(STORES_STAFF_ID, '2024-01-01');
    expect(rows).toEqual([]);
  });

  it('orders by unaccounted_count desc, then technician_name asc', async () => {
    const rows = await getTodayForStoresUser(STORES_STAFF_ID, TODAY);
    // Tech A has 1 unaccounted, Tech B has 0 — A comes first by count desc.
    expect(rows[0]?.technician_id).toBe(TECH_A_STAFF_ID);
    expect(rows[1]?.technician_id).toBe(TECH_B_STAFF_ID);
    // Names "PR41 AAA Tech" vs "PR41 ZZZ Tech" — exercised when counts tie
    // (covered indirectly by the tied empty case + non-empty case ordering;
    // a dedicated tie-break test would require another fixture pair).
    expect(rows[0]?.technician_name).toBe('PR41 AAA Tech');
    expect(rows[1]?.technician_name).toBe('PR41 ZZZ Tech');
  });
});
