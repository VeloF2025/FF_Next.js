/**
 * tests/db/services/field-stock-pwa/storesTodayService.test.ts
 *
 * Integration tests for getTodayForStoresUser(). Runs against the Wave-1
 * docker-compose harness. Applies migration 371 inline so the test DB
 * has `stock_pickings.created_by_staff_id` before any test inserts.
 *
 * Convention: same INSERT-only / targeted-DELETE pattern as
 * tests/db/services/field-stock/searchSerials.test.ts. PR41-prefixed UUIDs
 * and `PR41-` serial-number prefixes so cleanup is precise.
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

// Distinct UUID range scoped to PR41 (Phase 4.1) so cleanup is targeted.
const STORES_USER_ID    = 'cccccccc-0000-0000-0000-000000000041';
const STORES_STAFF_ID   = 'cccccccc-0000-0000-0000-000000000141';
const OTHER_USER_ID     = 'cccccccc-0000-0000-0000-000000000042';
const OTHER_STAFF_ID    = 'cccccccc-0000-0000-0000-000000000142';
const TECH_A_STAFF_ID   = 'cccccccc-0000-0000-0000-000000000201';
const TECH_B_STAFF_ID   = 'cccccccc-0000-0000-0000-000000000202';
const ITEM_ID           = 'cccccccc-0000-0000-0000-000000000301';
const WAREHOUSE_ID      = 'cccccccc-0000-0000-0000-000000000401';
const FIELD_LOCATION_ID = 'cccccccc-0000-0000-0000-000000000402';
const SERIAL_A1         = 'cccccccc-0000-0000-0000-000000000501'; // tech A, today, installed
const SERIAL_A2         = 'cccccccc-0000-0000-0000-000000000502'; // tech A, today, unaccounted
const SERIAL_B1         = 'cccccccc-0000-0000-0000-000000000503'; // tech B, today, returned
const SERIAL_OTHER      = 'cccccccc-0000-0000-0000-000000000504'; // other-stores-user issue today

const pool = new Pool({ connectionString: TEST_DB_URL });

const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC ≈ SAST

beforeAll(async () => {
  // Apply migration 371 (idempotent, ALTER + INDEX IF NOT EXISTS).
  const mig = await fs.readFile(
    path.join(process.cwd(), 'scripts/migrations/sql/371_pwa_picking_staff_attribution.sql'),
    'utf8',
  );
  await pool.query(mig);

  // Two users + matching staff (one stores, one "other" to confirm scoping).
  await pool.query(
    `INSERT INTO users (id, email, password_hash, role, first_name, last_name)
     VALUES
       ($1, 'pr41-stores@test.local', 'x', 'storeman', 'PR41', 'Stores'),
       ($2, 'pr41-other@test.local',  'x', 'storeman', 'PR41', 'Other')
     ON CONFLICT (id) DO NOTHING`,
    [STORES_USER_ID, OTHER_USER_ID],
  );
  await pool.query(
    `INSERT INTO staff (id, user_id, first_name, last_name, role)
     VALUES
       ($1, $2, 'PR41', 'Stores', 'stores'),
       ($3, $4, 'PR41', 'Other',  'stores'),
       ($5, NULL, 'PR41', 'TechA', 'technician'),
       ($6, NULL, 'PR41', 'TechB', 'technician')
     ON CONFLICT (id) DO NOTHING`,
    [STORES_STAFF_ID, STORES_USER_ID, OTHER_STAFF_ID, OTHER_USER_ID, TECH_A_STAFF_ID, TECH_B_STAFF_ID],
  );

  // Stock fixtures.
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type, standard_cost)
     VALUES ($1, 'PR41-ONT', 'PR41 Test ONT', 'ONT', 'serial', 1500.00)
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ID],
  );
  await pool.query(
    `INSERT INTO stock_locations (id, code, name, location_type)
     VALUES ($1, 'PR41-WH', 'PR41 Warehouse', 'warehouse'),
            ($2, 'PR41-FIELD', 'PR41 Field', 'technician')
     ON CONFLICT (id) DO NOTHING`,
    [WAREHOUSE_ID, FIELD_LOCATION_ID],
  );
  await pool.query(
    `INSERT INTO stock_serials (id, stock_item_id, serial_number, status)
     VALUES
       ($1, $5, 'PR41-A1', 'available'),
       ($2, $5, 'PR41-A2', 'available'),
       ($3, $5, 'PR41-B1', 'available'),
       ($4, $5, 'PR41-OT', 'available')
     ON CONFLICT (id) DO NOTHING`,
    [SERIAL_A1, SERIAL_A2, SERIAL_B1, SERIAL_OTHER, ITEM_ID],
  );
});

afterAll(async () => {
  try {
    // FK-safe order: events → return-lines → return-headers → picking-lines → pickings → serials → items → locations → staff → users
    await pool.query(`DELETE FROM stock_serial_events WHERE serial_id = ANY($1::uuid[])`, [
      [SERIAL_A1, SERIAL_A2, SERIAL_B1, SERIAL_OTHER],
    ]);
    await pool.query(
      `DELETE FROM stock_return_lines WHERE return_id IN (SELECT id FROM stock_returns WHERE returned_by_id = ANY($1::uuid[]))`,
      [[TECH_A_STAFF_ID, TECH_B_STAFF_ID]],
    );
    await pool.query(`DELETE FROM stock_returns WHERE returned_by_id = ANY($1::uuid[])`, [[TECH_A_STAFF_ID, TECH_B_STAFF_ID]]);
    await pool.query(`DELETE FROM stock_picking_lines WHERE picking_id IN (SELECT id FROM stock_pickings WHERE created_by_staff_id = ANY($1::uuid[]))`, [[STORES_STAFF_ID, OTHER_STAFF_ID]]);
    await pool.query(`DELETE FROM stock_pickings WHERE created_by_staff_id = ANY($1::uuid[])`, [[STORES_STAFF_ID, OTHER_STAFF_ID]]);
    await pool.query(`DELETE FROM stock_serials WHERE id = ANY($1::uuid[])`, [[SERIAL_A1, SERIAL_A2, SERIAL_B1, SERIAL_OTHER]]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ID]);
    await pool.query(`DELETE FROM stock_locations WHERE id = ANY($1::uuid[])`, [[WAREHOUSE_ID, FIELD_LOCATION_ID]]);
    await pool.query(`DELETE FROM staff WHERE id = ANY($1::uuid[])`, [[STORES_STAFF_ID, OTHER_STAFF_ID, TECH_A_STAFF_ID, TECH_B_STAFF_ID]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[STORES_USER_ID, OTHER_USER_ID]]);
  } finally {
    await pool.end();
  }
});

async function insertPicking(opts: {
  pickingId: string;
  pickingNumber: string;
  storesStaffId: string | null;
  technicianStaffId: string;
  serialIds: string[];
}) {
  await pool.query(
    `INSERT INTO stock_pickings (
       id, picking_number, picking_type, source_location_id, destination_location_id,
       technician_id, technician_name, status, created_by_staff_id
     ) VALUES ($1, $2, 'issue', $3, $4, $5, 'PR41 Tech', 'done', $6)
     ON CONFLICT (id) DO NOTHING`,
    [opts.pickingId, opts.pickingNumber, WAREHOUSE_ID, FIELD_LOCATION_ID, opts.technicianStaffId, opts.storesStaffId],
  );
  await pool.query(
    `INSERT INTO stock_picking_lines (picking_id, stock_item_id, planned_quantity, serial_ids, status)
     VALUES ($1, $2, $3, $4, 'done')`,
    [opts.pickingId, ITEM_ID, opts.serialIds.length, opts.serialIds],
  );
}

describe('getTodayForStoresUser', () => {
  beforeAll(async () => {
    // Picking 1: stores user → tech A → serials A1 + A2 (today)
    await insertPicking({
      pickingId: 'cccccccc-0000-0000-0000-000000000601',
      pickingNumber: 'PR41-001',
      storesStaffId: STORES_STAFF_ID,
      technicianStaffId: TECH_A_STAFF_ID,
      serialIds: [SERIAL_A1, SERIAL_A2],
    });
    // Picking 2: stores user → tech B → serial B1 (today)
    await insertPicking({
      pickingId: 'cccccccc-0000-0000-0000-000000000602',
      pickingNumber: 'PR41-002',
      storesStaffId: STORES_STAFF_ID,
      technicianStaffId: TECH_B_STAFF_ID,
      serialIds: [SERIAL_B1],
    });
    // Picking 3: OTHER stores user → tech A → serial OTHER (today) — must NOT appear
    await insertPicking({
      pickingId: 'cccccccc-0000-0000-0000-000000000603',
      pickingNumber: 'PR41-003',
      storesStaffId: OTHER_STAFF_ID,
      technicianStaffId: TECH_A_STAFF_ID,
      serialIds: [SERIAL_OTHER],
    });

    // Install event for A1 today (counts as installed for tech A).
    await pool.query(
      `INSERT INTO stock_serial_events (serial_id, event_type, from_state, to_state, source_table, occurred_at)
       VALUES ($1, 'installed_at_drop', 'available', 'installed', 'drops', NOW())`,
      [SERIAL_A1],
    );

    // Return for B1 today (counts as returned for tech B).
    await pool.query(
      `INSERT INTO stock_returns (id, return_number, returned_by_id, status)
       VALUES ('cccccccc-0000-0000-0000-000000000701', 'PR41-RET-001', $1, 'pending')
       ON CONFLICT (id) DO NOTHING`,
      [TECH_B_STAFF_ID],
    );
    await pool.query(
      `INSERT INTO stock_return_lines (return_id, stock_item_id, serial_id)
       VALUES ('cccccccc-0000-0000-0000-000000000701', $1, $2)`,
      [ITEM_ID, SERIAL_B1],
    );
  });

  it('returns one row per technician issued to TODAY by THIS stores user', async () => {
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

  it('excludes pickings created by other stores users', async () => {
    const rows = await getTodayForStoresUser(OTHER_STAFF_ID, TODAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.technician_id).toBe(TECH_A_STAFF_ID);
    expect(rows[0]?.issued_count).toBe(1); // only the OTHER-user picking
  });

  it('returns empty when stores user issued nothing today', async () => {
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
    // Tech A has 1 unaccounted, Tech B has 0 — A must come first.
    expect(rows[0]?.technician_id).toBe(TECH_A_STAFF_ID);
    expect(rows[1]?.technician_id).toBe(TECH_B_STAFF_ID);
  });
});
