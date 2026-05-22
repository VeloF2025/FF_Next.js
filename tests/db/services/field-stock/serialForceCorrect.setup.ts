/**
 * Shared setup, helpers, and fixture constants for serialForceCorrect tests.
 *
 * Vitest does not re-bind lifecycle hooks imported from other modules, so this
 * module exports plain async functions. Each spec file calls:
 *
 *   beforeAll(setupFixtures)
 *   beforeEach(resetFixtures)
 *   afterAll(teardownFixtures)
 *
 * inside its own describe block.
 */
import { Pool } from 'pg';

const TEST_DB_URL = process.env.DATABASE_URL_TEST;
if (!TEST_DB_URL) {
  throw new Error(
    'DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml or run via `npm run test:db`.'
  );
}

// ============================================================================
// Fixture UUIDs
// PR8 tests use aaaaaaaa-000…001-004; PR9A tests use bbbbbbbb-000…001-003.
// PR9B-FC tests use cccccccc-000…001-002.
// ============================================================================

export const ITEM_ONT     = 'cccccccc-0000-0000-0000-000000000001';
export const WAREHOUSE_FC = 'cccccccc-0000-0000-0000-000000000002';

// Reuse the seeded user row — 22222222… is always present (seed.sql line 29).
export const TEST_USER_ID       = '22222222-2222-2222-2222-222222222222';
export const PERFORMED_BY_NAME  = 'Force Correct Tester';

export const SN_A = 'PR9B-FC-A';
export const SN_B = 'PR9B-FC-B';

// ============================================================================
// Shared pool
// ============================================================================

export const pool = new Pool({ connectionString: TEST_DB_URL });

// ============================================================================
// Lifecycle functions (call from describe-scoped hooks in each spec file)
// ============================================================================

export async function setupFixtures(): Promise<void> {
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'PR9B-FC-ONT', 'PR9B FC Test ONT', 'ONT', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ONT],
  );
  await pool.query(
    `INSERT INTO stock_locations (id, code, name, location_type)
     VALUES ($1, 'PR9B-FC-WH', 'PR9B FC Warehouse', 'warehouse')
     ON CONFLICT (id) DO NOTHING`,
    [WAREHOUSE_FC],
  );
  await pool.query(
    `INSERT INTO stock_serials
       (stock_item_id, serial_number, status, installed_at_drop_number)
     VALUES
       ($1, $2, 'installed', 'PR9B-DR-001'),
       ($1, $3, 'available', NULL)
     ON CONFLICT (stock_item_id, serial_number) DO NOTHING`,
    [ITEM_ONT, SN_A, SN_B],
  );
}

export async function resetFixtures(): Promise<void> {
  await pool.query(
    `UPDATE stock_serials
        SET status = 'installed',
            installed_at_drop_number = 'PR9B-DR-001',
            current_location_id = NULL,
            allocated_to_project_id = NULL,
            activated_at_olt_id = NULL,
            updated_at = NOW()
      WHERE serial_number = $1`,
    [SN_A],
  );
  await pool.query(
    `UPDATE stock_serials
        SET status = 'available',
            installed_at_drop_number = NULL,
            current_location_id = NULL,
            allocated_to_project_id = NULL,
            activated_at_olt_id = NULL,
            updated_at = NOW()
      WHERE serial_number = $1`,
    [SN_B],
  );
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN (
        SELECT id FROM stock_serials WHERE serial_number LIKE 'PR9B-FC-%'
      )`,
  );
}

export async function teardownFixtures(): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events
        WHERE serial_id IN (
          SELECT id FROM stock_serials WHERE serial_number LIKE 'PR9B-FC-%'
        )`,
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE 'PR9B-FC-%'`);
    await pool.query(`DELETE FROM stock_locations WHERE id = $1`, [WAREHOUSE_FC]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ONT]);
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Query helpers
// ============================================================================

export async function getSerial(sn: string) {
  const { rows } = await pool.query<{
    status: string;
    installed_at_drop_number: string | null;
    current_location_id: string | null;
    allocated_to_project_id: string | null;
    activated_at_olt_id: string | null;
  }>(
    `SELECT status,
            installed_at_drop_number,
            current_location_id,
            allocated_to_project_id,
            activated_at_olt_id
       FROM stock_serials
      WHERE serial_number = $1`,
    [sn],
  );
  return rows[0] ?? null;
}

export async function getAuditRows(sn: string) {
  const { rows } = await pool.query<{
    event_type: string;
    from_state: string | null;
    to_state: string | null;
    actor_user_id: string | null;
    payload: Record<string, unknown>;
  }>(
    `SELECT e.event_type, e.from_state, e.to_state,
            e.actor_user_id::text, e.payload
       FROM stock_serial_events e
       JOIN stock_serials s ON s.id = e.serial_id
      WHERE s.serial_number = $1
      ORDER BY e.occurred_at`,
    [sn],
  );
  return rows;
}

// ============================================================================
// Shared base params factory
// ============================================================================

import type { ForceCorrectParams } from '@/modules/procurement/field-stock/services/serialForceCorrectService';

export function baseParams(overrides: Partial<ForceCorrectParams> = {}): ForceCorrectParams {
  return {
    serials: [SN_A],
    target: { status: 'available' as const },
    reason: 'test reason',
    performedBy: TEST_USER_ID,
    performedByName: PERFORMED_BY_NAME,
    dryRun: false,
    ...overrides,
  };
}
