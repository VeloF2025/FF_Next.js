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
 * Fixture setup (DDL, seeding, mig 364 TRIGGER 3 cleanup) lives in
 * cascadeFixture.ts to keep this file under the 300-line CLAUDE.md ceiling.
 *
 * Config: vitest.db.sprinte.config.ts (Sprint E Docker + mig 387)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { cascadePpResolution } from '@/modules/activate/services/cascadePpResolution';
import {
  setupCascadeFixture,
  type CascadeFixtureHandle,
  SN_PREFIX,
} from './cascadeFixture';

// ─── Module-level pool ────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let fixture: CascadeFixtureHandle;

// cutoffTime: set BEFORE seeding resolved PPs so all test PP rows are after it.
// Captured inside setupCascadeFixture — exposed here via the fixture object.
// We need a local cutoffTime for the cascade call; the fixture captures it
// internally but we need it in the test. We seed it before calling the fixture.
let cutoffTime: Date;

// ─── beforeAll: delegate to fixture helper ────────────────────────────────────
beforeAll(async () => {
  // Capture cutoffTime BEFORE the fixture seeds PP rows (so all resolved_at
  // values are strictly AFTER cutoffTime, satisfying WHERE pp.resolved_at >= $1).
  cutoffTime = new Date();
  // Small pause so NOW() in PP inserts is strictly after cutoffTime.
  await new Promise((r) => setTimeout(r, 20));

  fixture = await setupCascadeFixture(pool);
});

// ─── afterAll: remove seeded rows in FK-safe order ───────────────────────────
afterAll(async () => {
  try {
    // Remove PP rows
    await pool.query(
      `DELETE FROM oes_pp_data WHERE serial_number LIKE $1`,
      [`${SN_PREFIX}%`],
    );
    // Remove test drops (four dedicated ones)
    await pool.query(
      `DELETE FROM drops WHERE drop_number = ANY($1::text[])`,
      [[fixture.DROP_ACTIVATED, fixture.DROP_INSTALLED, fixture.DROP_INSTOCK, fixture.DROP_ISSUED]],
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
      [fixture.activatedSerialId],
    );
    expect(row.rows[0]?.status).toBe('activated');
    expect(row.rows[0]?.installed_at_drop_number).toBe(fixture.DROP_ACTIVATED);

    const events = await pool.query(
      `SELECT * FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.activatedSerialId],
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
      [fixture.installedSerialId],
    );
    expect(row.rows[0]?.status).toBe('installed');
    expect(row.rows[0]?.installed_at_drop_number).toBe(fixture.DROP_INSTALLED);

    const events = await pool.query(
      `SELECT * FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.installedSerialId],
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
      [fixture.inStockSerialId],
    );
    expect(row.rows[0]?.status).toBe('installed');
    expect(row.rows[0]?.installed_at_drop_number).toBe(fixture.DROP_INSTOCK);

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
      [fixture.inStockSerialId],
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
      [fixture.issuedSerialId],
    );
    expect(row.rows[0]?.status).toBe('installed');
    expect(row.rows[0]?.installed_at_drop_number).toBe(fixture.DROP_ISSUED);

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
      [fixture.issuedSerialId],
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
