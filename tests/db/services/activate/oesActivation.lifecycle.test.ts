/**
 * tests/db/services/activate/oesActivation.lifecycle.test.ts
 *
 * Sprint E Track 2.6 — OES installed → activated lifecycle transition.
 *
 * Tests the exported `promoteOesActivatedSerials()` helper from
 * oesSerialLifecycle.ts in ISOLATION, mirroring the cascadeFixture.ts
 * test posture from Track 2.4 (TRIGGER 3 side-effects cleaned up before
 * each assertion).
 *
 * Case A (happy path):
 *   - Seed a serial in 'installed' state (cascade fixture's installedSerialId).
 *   - Call promoteOesActivatedSerials with that serial.
 *   - Assert: status promoted to 'activated'.
 *   - Assert: exactly ONE new event row with event_type='activated',
 *     from_state='installed', to_state='activated', source_table='oes_activations'.
 *
 * Case B (guard — already-activated serial skipped):
 *   - Use cascade fixture's activatedSerialId (status='activated').
 *   - Call promoteOesActivatedSerials with that serial.
 *   - Assert: status unchanged (still 'activated').
 *   - Assert: NO new stock_serial_events row emitted — the status!='installed'
 *     guard in promoteOesActivatedSerials returns early without calling
 *     promoteSerial, so the mig 387 emit trigger never fires.
 *   - Assert: no exception raised.
 *
 * Requires: Sprint E container (mig 387 triggers via vitest.db.sprinte.config.ts).
 * Config: vitest.db.sprinte.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { promoteOesActivatedSerials } from '@/modules/activate/services/oes/oesSerialLifecycle';
import {
  setupCascadeFixture,
  type CascadeFixtureHandle,
  SN_PREFIX,
} from './cascadeFixture';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL not set — run via vitest.db.sprinte.config.ts');
}

const pool = new Pool({ connectionString: TEST_DB_URL });

let fixture: CascadeFixtureHandle;

beforeAll(async () => {
  fixture = await setupCascadeFixture(pool);
});

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM oes_pp_data WHERE serial_number LIKE $1`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM drops WHERE drop_number = ANY($1::text[])`,
      [[fixture.DROP_ACTIVATED, fixture.DROP_INSTALLED, fixture.DROP_INSTOCK, fixture.DROP_ISSUED]],
    );
    await pool.query(
      `DELETE FROM stock_serial_events WHERE serial_id IN (
         SELECT id FROM stock_serials WHERE serial_number LIKE $1
       )`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(
      `DELETE FROM stock_serials WHERE serial_number LIKE $1`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(`DELETE FROM stock_items WHERE item_code = 'TRACK2-CASCADE-GENERIC'`);
  } finally {
    await pool.end();
  }
});

describe('promoteOesActivatedSerials — OES installed→activated lifecycle (Track 2.6)', () => {
  /**
   * Case A: installed serial is promoted via the helper.
   *
   * setupCascadeFixture seeds installedSerialId with status='installed' and
   * cleans up TRIGGER 3 side-effects so we start from a clean state.
   */
  it('Case A — installed serial: promotes to activated, emits one event', async () => {
    // Resolve the serial_number for the fixture's installed serial row.
    const snRow = await pool.query<{ serial_number: string }>(
      `SELECT serial_number FROM stock_serials WHERE id = $1`,
      [fixture.installedSerialId],
    );
    const serialNumber = snRow.rows[0].serial_number;

    // Pre-condition: status is 'installed', no events yet.
    const before = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.installedSerialId],
    );
    expect(before.rows[0]?.status).toBe('installed');

    const eventsBefore = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.installedSerialId],
    );
    expect(Number(eventsBefore.rows[0]?.cnt)).toBe(0);

    // Call the actual shipped helper.
    await promoteOesActivatedSerials([
      { serial_number: serialNumber, drop_number: fixture.DROP_INSTALLED },
    ]);

    // Assert: status promoted to activated.
    const after = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.installedSerialId],
    );
    expect(after.rows[0]?.status).toBe('activated');

    // Assert: exactly one event row, correct fields.
    const events = await pool.query<{
      event_type:   string;
      from_state:   string | null;
      to_state:     string | null;
      source_table: string | null;
    }>(
      `SELECT event_type, from_state, to_state, source_table
         FROM stock_serial_events
        WHERE serial_id = $1
        ORDER BY occurred_at`,
      [fixture.installedSerialId],
    );
    expect(events.rows).toHaveLength(1);
    // mig 387 matrix row 73: ('installed', 'activated', 'activated', 'OES activation')
    expect(events.rows[0]).toMatchObject({
      event_type:   'activated',
      from_state:   'installed',
      to_state:     'activated',
      source_table: 'oes_activations',
    });
  });

  /**
   * Case B: already-activated serial is skipped by the status guard.
   *
   * setupCascadeFixture seeds activatedSerialId with status='activated'.
   * The helper's `serial.status !== 'installed'` guard returns early without
   * calling promoteSerial — no event fires, no exception raised.
   */
  it('Case B — already-activated serial: guard skips it, no new event, no throw', async () => {
    const snRow = await pool.query<{ serial_number: string }>(
      `SELECT serial_number FROM stock_serials WHERE id = $1`,
      [fixture.activatedSerialId],
    );
    const serialNumber = snRow.rows[0].serial_number;

    // Pre-condition: status is 'activated', no events (fixture cleaned them).
    const before = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.activatedSerialId],
    );
    expect(before.rows[0]?.status).toBe('activated');

    const cntBefore = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.activatedSerialId],
    );
    const eventCountBefore = Number(cntBefore.rows[0]?.cnt);

    // Call the helper — must not throw.
    await expect(
      promoteOesActivatedSerials([
        { serial_number: serialNumber, drop_number: fixture.DROP_ACTIVATED },
      ]),
    ).resolves.toBeUndefined();

    // Assert: status unchanged.
    const after = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.activatedSerialId],
    );
    expect(after.rows[0]?.status).toBe('activated');

    // Assert: no new event row — the guard returned before calling promoteSerial.
    const cntAfter = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.activatedSerialId],
    );
    expect(Number(cntAfter.rows[0]?.cnt)).toBe(eventCountBefore);
  });

  /**
   * Case C (mig 393 reconciliation path): in_stock serial is promoted directly
   * to activated via the in_stock→activated transition, emitting a DEDICATED
   * event_type 'activated_on_oes'. This is the Group A fix (#1860) — before
   * mig 393 + the widened guard, an in_stock OES-active serial raised FF001 and
   * stayed stuck. Requires migration 393 applied to the test container.
   */
  it('Case C — in_stock serial: promotes to activated, emits one activated_on_oes event', async () => {
    const snRow = await pool.query<{ serial_number: string }>(
      `SELECT serial_number FROM stock_serials WHERE id = $1`,
      [fixture.inStockSerialId],
    );
    const serialNumber = snRow.rows[0].serial_number;

    const before = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.inStockSerialId],
    );
    expect(before.rows[0]?.status).toBe('in_stock');

    const eventsBefore = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.inStockSerialId],
    );
    expect(Number(eventsBefore.rows[0]?.cnt)).toBe(0);

    await promoteOesActivatedSerials([
      { serial_number: serialNumber, drop_number: fixture.DROP_INSTOCK },
    ]);

    const after = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.inStockSerialId],
    );
    expect(after.rows[0]?.status).toBe('activated');

    const events = await pool.query<{
      event_type:   string;
      from_state:   string | null;
      to_state:     string | null;
      source_table: string | null;
    }>(
      `SELECT event_type, from_state, to_state, source_table
         FROM stock_serial_events
        WHERE serial_id = $1
        ORDER BY occurred_at`,
      [fixture.inStockSerialId],
    );
    expect(events.rows).toHaveLength(1);
    // mig 393: ('in_stock', 'activated', 'activated_on_oes', 'OES reconciliation')
    expect(events.rows[0]).toMatchObject({
      event_type:   'activated_on_oes',
      from_state:   'in_stock',
      to_state:     'activated',
      source_table: 'oes_activations',
    });
  });

  /**
   * Case D (guard — no →activated transition): a serial in 'issued' (no matrix
   * edge to 'activated') is skipped with a warning, NOT promoted and NOT crashed
   * with FF001. Status unchanged, no event emitted, no throw.
   */
  it('Case D — issued serial: no transition to activated, guard skips it, no event, no throw', async () => {
    const snRow = await pool.query<{ serial_number: string }>(
      `SELECT serial_number FROM stock_serials WHERE id = $1`,
      [fixture.issuedSerialId],
    );
    const serialNumber = snRow.rows[0].serial_number;

    const before = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.issuedSerialId],
    );
    expect(before.rows[0]?.status).toBe('issued');

    const cntBefore = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.issuedSerialId],
    );
    const eventCountBefore = Number(cntBefore.rows[0]?.cnt);

    await expect(
      promoteOesActivatedSerials([
        { serial_number: serialNumber, drop_number: fixture.DROP_ISSUED },
      ]),
    ).resolves.toBeUndefined();

    const after = await pool.query<{ status: string }>(
      `SELECT status FROM stock_serials WHERE id = $1`,
      [fixture.issuedSerialId],
    );
    expect(after.rows[0]?.status).toBe('issued');

    const cntAfter = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM stock_serial_events WHERE serial_id = $1`,
      [fixture.issuedSerialId],
    );
    expect(Number(cntAfter.rows[0]?.cnt)).toBe(eventCountBefore);
  });
});
