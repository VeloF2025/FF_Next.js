/**
 * tests/db/services/activate/oesReconcileInStock.lifecycle.test.ts
 *
 * Durable reconciliation for the OES activation path (issue #1860 regrowth).
 *
 * Tests `reconcileInStockOesActivated()` from oesSerialLifecycle.ts. Unlike
 * `promoteOesActivatedSerials()` (which only sees the PP-resolution delta the
 * nightly import hands it), this helper runs a FULL scan of `oes_activations`
 * for serials Active on OES yet still stuck `in_stock` and promotes them — the
 * forward fix that stops the in_stock⇄OES-Active gap from regrowing.
 *
 * `oes_activations` is not in the base test seed, so (like cascadeFixture stubs
 * maintenance_*) we CREATE a minimal stub here with only the columns the helper
 * reads (serial_number, status, activation_date, drop_number).
 *
 * Case A (happy path):
 *   - Seed an in_stock serial + an Active oes_activations row for it (NO
 *     oes_pp_data — proving the PP-delta path is bypassed).
 *   - Call reconcileInStockOesActivated().
 *   - Assert: status promoted to 'activated', one 'activated_on_oes' event.
 *
 * Case B (idempotent):
 *   - Call it again. The serial is now 'activated' → not in the in_stock scan.
 *   - Assert: status unchanged, no new event, no throw.
 *
 * Config: vitest.db.sprinte.config.ts (needs mig 387 + mig 393 triggers).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { reconcileInStockOesActivated } from '@/modules/activate/services/oes/oesSerialLifecycle';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL not set — run via vitest.db.sprinte.config.ts');
}

const LOC_WAREHOUSE_ID = '10000000-0000-0000-0000-000000000001'; // WAREHOUSE-001 (seed.sql)
const SN_PREFIX = 'OES-RECON-';
const SERIAL   = `${SN_PREFIX}INSTOCK-001`;
const DROP     = 'OES-RECON-DROP-001';

const pool = new Pool({ connectionString: TEST_DB_URL });
let serialId: string;

beforeAll(async () => {
  // Minimal oes_activations stub — only the columns the helper reads.
  await pool.query(`CREATE TABLE IF NOT EXISTS oes_activations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_number   TEXT,
    status          TEXT,
    activation_date DATE,
    drop_number     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
  )`);

  await pool.query(
    `INSERT INTO drops (drop_number) VALUES ($1) ON CONFLICT (drop_number) DO NOTHING`,
    [DROP],
  );

  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('OES-RECON-GENERIC', 'OES Recon Test Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  const itemId = itemRes.rows[0].id;

  // Seed the serial in_stock via bypass (in_stock is not reachable from __new__).
  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const res = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'in_stock', $3) RETURNING id`,
      [SERIAL, itemId, LOC_WAREHOUSE_ID],
    );
    await seedClient.query('COMMIT');
    serialId = res.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }

  // OES says this serial is Active — but there is NO oes_pp_data row, so the
  // PP-delta path would never promote it. Only the reconciliation scan can.
  await pool.query(
    `INSERT INTO oes_activations (serial_number, status, activation_date, drop_number)
     VALUES ($1, 'Active', CURRENT_DATE, $2)`,
    [SERIAL, DROP],
  );

  // Clear any events from seeding so assertions start clean.
  await pool.query(`DELETE FROM stock_serial_events WHERE serial_id = $1`, [serialId]);
});

afterAll(async () => {
  try {
    await pool.query(`DELETE FROM oes_activations WHERE serial_number LIKE $1`, [`${SN_PREFIX}%`]);
    await pool.query(
      `DELETE FROM stock_serial_events WHERE serial_id IN (
         SELECT id FROM stock_serials WHERE serial_number LIKE $1)`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE $1`, [`${SN_PREFIX}%`]);
    await pool.query(`DELETE FROM drops WHERE drop_number = $1`, [DROP]);
    await pool.query(`DELETE FROM stock_items WHERE item_code = 'OES-RECON-GENERIC'`);
  } finally {
    await pool.end();
  }
});

describe('reconcileInStockOesActivated — durable OES in_stock→activated forward fix (#1860)', () => {
  it('Case A — in_stock serial Active on OES (no PP row): promoted to activated, one activated_on_oes event', async () => {
    const before = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`, [serialId]);
    expect(before.rows[0]?.status).toBe('in_stock');

    const result = await reconcileInStockOesActivated();
    expect(result.scanned).toBeGreaterThanOrEqual(1);

    const after = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`, [serialId]);
    expect(after.rows[0]?.status).toBe('activated');

    const events = await pool.query<{
      event_type: string; from_state: string | null; to_state: string | null; source_table: string | null;
    }>(
      `SELECT event_type, from_state, to_state, source_table
         FROM stock_serial_events WHERE serial_id = $1 ORDER BY occurred_at`,
      [serialId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      event_type:   'activated_on_oes',
      from_state:   'in_stock',
      to_state:     'activated',
      source_table: 'oes_activations',
    });
  });

  it('Case B — idempotent: re-run leaves the now-activated serial untouched, no new event, no throw', async () => {
    const cntBefore = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`, [serialId]);

    await expect(reconcileInStockOesActivated()).resolves.toMatchObject({ scanned: expect.any(Number) });

    const after = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`, [serialId]);
    expect(after.rows[0]?.status).toBe('activated');

    const cntAfter = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`, [serialId]);
    expect(Number(cntAfter.rows[0]?.cnt)).toBe(Number(cntBefore.rows[0]?.cnt));
  });
});
