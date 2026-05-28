/**
 * tests/db/services/field-stock/returnsAccept.lifecycle.test.ts
 *
 * Integration test for Task 2.3: confirms that the returns accept handler
 * routes serial status writes through promoteSerial instead of direct UPDATEs.
 *
 * Requirements for PASS:
 *   - Sprint E container (mig 387 triggers installed via vitest.db.sprinte.config.ts)
 *   - stock_holders seed row from sprint-e-holders-seed.sql
 *
 * Test scope (direct-call shape — mirrors Task 2.2):
 *   Rather than driving the full HTTP handler (which requires stock_returns
 *   columns not in the test schema), we call promoteSerial directly inside a
 *   transaction() block — exactly as the refactored production code does.
 *   This is the testable contract for Track 2.3.
 *
 *   Scrap path: serial in 'returned' state → promoteSerial to 'scrapped'
 *     → exactly one event row with event_type='scrapped', source_table='stock_returns'
 *     Matrix row: ('returned','scrapped','scrapped','Return disposition=scrap')
 *
 *   Faulty/repair path: serial in 'issued' state → promoteSerial to 'faulty'
 *     → exactly one event row with event_type='marked_faulty', source_table='stock_returns'
 *     Matrix row: ('issued','faulty','marked_faulty','Tech-side fault before install')
 *
 * Matrix notes:
 *   - ('issued','scrapped') has NO matrix row. Post-cutover, an issued→scrapped
 *     UPDATE would throw FF001. This is a Track 5/7 cutover concern.
 *     Test seeds serial in 'returned' state for the scrap case to use a valid row.
 *   - ('returned','scrapped') IS in the matrix — valid for scrap test.
 *   - ('issued','faulty') IS in the matrix — valid for repair test.
 *
 * Isolation: uses TRACK2-RETURN- prefixed serial numbers; afterAll cleans up
 * events + serials so re-runs start clean.
 *
 * Config: vitest.db.sprinte.config.ts (Sprint E Docker + mig 387)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool }          from 'pg';
import { transaction }   from '@/lib/db-pool';
import { promoteSerial } from '@/modules/procurement/field-stock/services/serialLifecycle';

// ─── Fixed seed references ────────────────────────────────────────────────────
// LOC_WAREHOUSE_ID: WAREHOUSE-001 from seed.sql
const LOC_WAREHOUSE_ID = '10000000-0000-0000-0000-000000000001';

// Synthetic return UUID — no stock_returns row needed because the test calls
// promoteSerial directly. The UUID is used only as sourceId in the event table.
const FAKE_RETURN_ID = 'facade00-0000-0000-0000-000000000003';

/** Prefix-scoped so afterAll DELETE is safe and won't touch unrelated rows. */
const SN_PREFIX = 'TRACK2-RETURN-';

// ─── Module-level pool ────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let itemId:       string;
let scrapSerialId: string;
let faultySerialId: string;

// ─── beforeAll: seed stock_item + two serials ─────────────────────────────────
beforeAll(async () => {
  // 1. Stock item — generic code so no side-effect queries fire
  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK2-RETURN-GENERIC', 'TRACK2 Returns Test Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  itemId = itemRes.rows[0].id;

  const seedClient = await pool.connect();
  try {
    await seedClient.query('BEGIN');
    // Use bypass=true to set non-standard initial states directly.
    // Scrap serial seeded in 'returned' — ('returned','scrapped') is in the matrix.
    // Faulty serial seeded in 'issued'  — ('issued','faulty') is in the matrix.
    await seedClient.query(`SET LOCAL ff.bypass_validation = 'true'`);

    const scrapRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'returned', $3)
       RETURNING id`,
      [`${SN_PREFIX}SCRAP-001`, itemId, LOC_WAREHOUSE_ID],
    );

    const faultyRes = await seedClient.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, current_location_id)
       VALUES ($1, $2, 'issued', $3)
       RETURNING id`,
      [`${SN_PREFIX}FAULTY-001`, itemId, LOC_WAREHOUSE_ID],
    );

    await seedClient.query('COMMIT');
    scrapSerialId  = scrapRes.rows[0].id;
    faultySerialId = faultyRes.rows[0].id;
  } catch (err) {
    await seedClient.query('ROLLBACK');
    throw err;
  } finally {
    seedClient.release();
  }

  // Delete any seed events emitted by the bypass INSERT so assertions are clean.
  await pool.query(
    `DELETE FROM stock_serial_events
      WHERE serial_id IN ($1, $2)`,
    [scrapSerialId, faultySerialId],
  );
});

// ─── afterAll: remove seeded rows in FK-safe order ───────────────────────────
afterAll(async () => {
  try {
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
      `DELETE FROM stock_items WHERE item_code = 'TRACK2-RETURN-GENERIC'`,
    );
  } finally {
    await pool.end();
  }
});

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('returns accept handler — serial lifecycle via promoteSerial (Task 2.3)', () => {
  /**
   * Scrap path: returned → scrapped
   *
   * Matrix row: ('returned','scrapped','scrapped','Return disposition=scrap')
   *
   * Asserts:
   *   1. stock_serials.status = 'scrapped'
   *   2. stock_serials.holder_id IS NULL (cleared by toHolderId=null)
   *   3. Exactly ONE stock_serial_events row with:
   *      - event_type   = 'scrapped'
   *      - from_state   = 'returned'
   *      - to_state     = 'scrapped'
   *      - source_table = 'stock_returns'
   */
  it('emits exactly one scrapped event with source_table=stock_returns (scrap disposition)', async () => {
    await transaction(async (txn) => {
      // Pass txn.client (raw PoolClient), never txn — the TxnClient wrapper has no
      // `release` and would misroute promoteSerial through its Pool branch.
      await promoteSerial(txn.client, {
        serialId:    scrapSerialId,
        toStatus:    'scrapped',
        toHolderId:  null,
        sourceTable: 'stock_returns',
        sourceId:    FAKE_RETURN_ID,
        actorStaffId: null,
        payload: {
          disposition:   'scrap',
          line_id:       'test-line-001',
          return_number: 'RET-TEST-001',
        },
      });
    });

    // Assertion 1: serial status = 'scrapped', holder_id cleared
    const serialRow = await pool.query<{ status: string; holder_id: string | null }>(
      `SELECT status, holder_id FROM stock_serials WHERE id = $1`,
      [scrapSerialId],
    );
    expect(serialRow.rows[0]?.status).toBe('scrapped');
    expect(serialRow.rows[0]?.holder_id).toBeNull();

    // Assertion 2: exactly ONE event row with the expected shape
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
      [scrapSerialId],
    );

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toEqual({
      event_type:   'scrapped',
      from_state:   'returned',
      to_state:     'scrapped',
      source_table: 'stock_returns',
    });
  });

  /**
   * Repair/faulty path: issued → faulty
   *
   * Matrix row: ('issued','faulty','marked_faulty','Tech-side fault before install')
   *
   * Asserts:
   *   1. stock_serials.status = 'faulty'
   *   2. stock_serials.holder_id IS NULL (cleared by toHolderId=null)
   *   3. Exactly ONE stock_serial_events row with:
   *      - event_type   = 'marked_faulty'
   *      - from_state   = 'issued'
   *      - to_state     = 'faulty'
   *      - source_table = 'stock_returns'
   */
  it('emits exactly one marked_faulty event with source_table=stock_returns (repair disposition)', async () => {
    await transaction(async (txn) => {
      // Pass txn.client (raw PoolClient), never txn.
      await promoteSerial(txn.client, {
        serialId:    faultySerialId,
        toStatus:    'faulty',
        toHolderId:  null,
        sourceTable: 'stock_returns',
        sourceId:    FAKE_RETURN_ID,
        actorStaffId: null,
        payload: {
          disposition:   'repair',
          line_id:       'test-line-002',
          return_number: 'RET-TEST-001',
        },
      });
    });

    // Assertion 1: serial status = 'faulty', holder_id cleared
    const serialRow = await pool.query<{ status: string; holder_id: string | null }>(
      `SELECT status, holder_id FROM stock_serials WHERE id = $1`,
      [faultySerialId],
    );
    expect(serialRow.rows[0]?.status).toBe('faulty');
    expect(serialRow.rows[0]?.holder_id).toBeNull();

    // Assertion 2: exactly ONE event row with the expected shape
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
      [faultySerialId],
    );

    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toEqual({
      event_type:   'marked_faulty',
      from_state:   'issued',
      to_state:     'faulty',
      source_table: 'stock_returns',
    });
  });
});
