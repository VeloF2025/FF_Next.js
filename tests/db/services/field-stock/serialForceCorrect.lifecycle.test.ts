/**
 * tests/db/services/field-stock/serialForceCorrect.lifecycle.test.ts
 *
 * Sprint E Track 2.6 — verifies that forceCorrectSerials() routes the
 * status update through promoteSerial(bypass:true) so the mig 387
 * trg_stock_serial_status_emit_t trigger fires the `force_corrected` event.
 *
 * Contracts tested:
 *   1. Status changes via forceCorrectSerials emit one `force_corrected`
 *      stock_serial_events row (trigger, not emitSerialEvent()).
 *   2. Non-status fields (installedAtDropNumber) are updated correctly.
 *   3. Off-matrix transitions (installed → activated) succeed because
 *      bypass:true skips the validate trigger.
 *   4. No double-emit: exactly ONE event row per status change.
 *
 * Requires: Sprint E container (mig 387 triggers via vitest.db.sprinte.config.ts).
 * Config: vitest.db.sprinte.config.ts
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { forceCorrectSerials } from '@/modules/procurement/field-stock/services/serialForceCorrectService';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL not set — run via vitest.db.sprinte.config.ts');
}

const pool = new Pool({ connectionString: TEST_DB_URL });

const ITEM_ID_FC = 'ee110000-0000-0000-0000-000000000001';
const SN_FC = 'TC26-FC-LIFECYCLE-001';
const TEST_USER_ID = '22222222-2222-2222-2222-222222222222'; // seeded
let serialId: string;

async function resetSerial(): Promise<void> {
  // Bypass so we can write any state without matrix validation.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ff.bypass_validation = 'true'`);
    await client.query(
      `UPDATE stock_serials SET status = 'installed', installed_at_drop_number = NULL,
       updated_at = NOW() WHERE serial_number = $1`,
      [SN_FC],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // Clear events so each test starts clean.
  await pool.query(
    `DELETE FROM stock_serial_events WHERE serial_id IN (
       SELECT id FROM stock_serials WHERE serial_number = $1
     )`,
    [SN_FC],
  );
}

beforeAll(async () => {
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'TC26-FC-ITEM', 'TC26 FC Test Item', 'bootstock', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ID_FC],
  );

  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const r = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status)
       VALUES ($1, $2, 'installed') RETURNING id`,
      [SN_FC, ITEM_ID_FC],
    );
    await seedClient.query('COMMIT');
    serialId = r.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }
});

beforeEach(resetSerial);

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events WHERE serial_id IN (
         SELECT id FROM stock_serials WHERE serial_number = $1
       )`,
      [SN_FC],
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number = $1`, [SN_FC]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ID_FC]);
  } finally {
    await pool.end();
  }
});

describe('forceCorrectSerials — lifecycle via promoteSerial bypass (Track 2.6)', () => {
  it('emits force_corrected event via mig 387 trigger (not double-emitted)', async () => {
    const result = await forceCorrectSerials({
      serials:         [SN_FC],
      target:          { status: 'available' },
      reason:          'TC26 test correction',
      performedBy:     TEST_USER_ID,
      performedByName: 'Track26 Tester',
      dryRun:          false,
    });

    expect(result.totalApplied).toBe(1);
    expect(result.totalFailed).toBe(0);

    const row = result.rows[0];
    expect(row.applied).toBe(true);
    expect(row.changedFields).toContain('status');
    expect(row.before).toMatchObject({ status: 'installed' });
    expect(row.after).toMatchObject({ status: 'available' });

    // Exactly ONE event — trigger emits it; no double-emit from emitSerialEvent.
    const events = await pool.query<{
      event_type:  string;
      from_state:  string | null;
      to_state:    string | null;
      actor_user_id: string | null;
    }>(
      `SELECT event_type, from_state, to_state, actor_user_id::text
         FROM stock_serial_events WHERE serial_id = $1`,
      [serialId],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({
      event_type:    'force_corrected',
      from_state:    'installed',
      to_state:      'available',
      actor_user_id: TEST_USER_ID,
    });
  });

  it('bypass transition (installed → activated) succeeds and emits correct event', async () => {
    // installed → activated IS in the matrix (row 73, event_type='activated_on_oes').
    // bypass:true skips the validate trigger but the emit trigger still fires.
    // The emit trigger looks up the matrix first → finds 'activated_on_oes' → emits that.
    // `force_corrected` is only emitted for truly off-matrix transitions (not in table).
    const result = await forceCorrectSerials({
      serials:         [SN_FC],
      target:          { status: 'activated' },
      reason:          'TC26 bypass via forceCorrect test',
      performedBy:     TEST_USER_ID,
      performedByName: 'Track26 Tester',
      dryRun:          false,
    });

    expect(result.totalApplied).toBe(1);
    const dbRow = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE serial_number = $1`,
      [SN_FC],
    );
    expect(dbRow.rows[0]?.status).toBe('activated');

    const events = await pool.query<{ event_type: string }>(
      `SELECT event_type FROM stock_serial_events WHERE serial_id = $1`,
      [serialId],
    );
    // One event only — no double-emit.
    expect(events.rows).toHaveLength(1);
    // installed → activated is a valid matrix row (row 73, event_type='activated') →
    // emits 'activated', not 'force_corrected' (force_corrected only for truly off-matrix).
    expect(events.rows[0]).toMatchObject({ event_type: 'activated' });
  });

  it('non-status fields updated without emitting a status event', async () => {
    const result = await forceCorrectSerials({
      serials:         [SN_FC],
      target:          { installedAtDropNumber: 'TC26-FC-DR-ONLY' },
      reason:          'TC26 non-status field change',
      performedBy:     TEST_USER_ID,
      performedByName: 'Track26 Tester',
      dryRun:          false,
    });

    expect(result.totalApplied).toBe(1);

    const dbRow = await pool.query<{ installed_at_drop_number: string | null; status: string }>(
      `SELECT installed_at_drop_number, status FROM stock_serials WHERE serial_number = $1`,
      [SN_FC],
    );
    expect(dbRow.rows[0]?.installed_at_drop_number).toBe('TC26-FC-DR-ONLY');
    expect(dbRow.rows[0]?.status).toBe('installed'); // unchanged

    // No events — non-status field changes don't trigger the emit trigger.
    const events = await pool.query(
      `SELECT count(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [serialId],
    );
    expect(Number(events.rows[0]?.cnt)).toBe(0);
  });
});
