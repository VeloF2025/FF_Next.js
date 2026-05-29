/**
 * tests/db/services/field-stock/holderBlockGuard.lifecycle.test.ts
 *
 * Integration test for Sprint E Task 4.1 (SOP-4.4): issue-time block enforcement.
 * Confirms `assertHolderNotBlocked` throws `HolderBlockedError` for a holder
 * flagged `is_blocked` in stock_accountability (read via v_holder_accountability),
 * passes for an unblocked holder, and — when used as the picking handler does
 * (guard BEFORE promoteSerial in one txn) — aborts before any serial is promoted.
 *
 * Requirements for PASS:
 *   - Sprint E container (mig 384 accountability + view, mig 387 triggers) via
 *     sprint-e-global-setup.ts
 *
 * Isolation: TRACK41-BLOCK- prefixed rows; afterAll cleans up events, serials,
 * accountability rows, and holders so re-runs start clean.
 *
 * Config: vitest.db.sprinte.config.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { transaction } from '@/lib/db-pool';
import { promoteSerial } from '@/modules/procurement/field-stock/services/serialLifecycle';
import {
  assertHolderNotBlocked,
  HolderBlockedError,
} from '@/modules/procurement/field-stock/services/holderBlockGuard';

const BLOCKED_HOLDER_ID   = 'b1000000-0000-0000-0000-000000000001';
const UNBLOCKED_HOLDER_ID = 'b1000000-0000-0000-0000-000000000002';
const BLOCK_REASON = 'TRACK41 test: unreturned stock over threshold';
const SN_PREFIX = 'TRACK41-BLOCK-';

const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

let itemId: string;
let issueSerialId: string;

beforeAll(async () => {
  // Two holders: one blocked (accountability is_blocked=true), one with no
  // accountability row at all (the COALESCE-to-false / no-row path).
  // holder_type='external_person' needs no staff/contractor FK (stock_holders_ref_chk),
  // so the holders stand alone without seeding staff/contractor rows.
  await pool.query(
    `INSERT INTO stock_holders (id, holder_type, name, is_active)
     VALUES ($1, 'external_person', $3, true), ($2, 'external_person', $4, true)
     ON CONFLICT (id) DO NOTHING`,
    [BLOCKED_HOLDER_ID, UNBLOCKED_HOLDER_ID, `${SN_PREFIX}BLOCKED`, `${SN_PREFIX}OK`],
  );
  await pool.query(
    `INSERT INTO stock_accountability (holder_id, is_blocked, blocked_reason, blocked_at)
     VALUES ($1, true, $2, now())
     ON CONFLICT (holder_id) DO UPDATE
       SET is_blocked = true, blocked_reason = EXCLUDED.blocked_reason`,
    [BLOCKED_HOLDER_ID, BLOCK_REASON],
  );

  const itemRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_items (item_code, name, category, tracking_type)
     VALUES ('TRACK41-BLOCK-GENERIC', 'TRACK41 Block Guard Test Item', 'bootstock', 'serial')
     ON CONFLICT (item_code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
  );
  itemId = itemRes.rows[0].id;

  // One serial in 'in_stock' (bypass the validate trigger to seed the start state,
  // matching the Track 2 test pattern), then clear the bypass-emitted event.
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    await seed.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const r = await seed.query<{ id: string }>(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status)
       VALUES ($1, $2, 'in_stock') RETURNING id`,
      [`${SN_PREFIX}ISSUE-001`, itemId],
    );
    await seed.query('COMMIT');
    issueSerialId = r.rows[0].id;
  } catch (err) {
    await seed.query('ROLLBACK');
    throw err;
  } finally {
    seed.release();
  }
  await pool.query(`DELETE FROM stock_serial_events WHERE serial_id = $1`, [issueSerialId]);
});

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events WHERE serial_id IN
         (SELECT id FROM stock_serials WHERE serial_number LIKE $1)`,
      [`${SN_PREFIX}%`],
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE $1`, [`${SN_PREFIX}%`]);
    await pool.query(`DELETE FROM stock_items WHERE item_code = 'TRACK41-BLOCK-GENERIC'`);
    await pool.query(`DELETE FROM stock_accountability WHERE holder_id IN ($1, $2)`,
      [BLOCKED_HOLDER_ID, UNBLOCKED_HOLDER_ID]);
    await pool.query(`DELETE FROM stock_holders WHERE id IN ($1, $2)`,
      [BLOCKED_HOLDER_ID, UNBLOCKED_HOLDER_ID]);
  } finally {
    await pool.end();
  }
});

describe('assertHolderNotBlocked — issue-time block enforcement (Task 4.1)', () => {
  it('throws HolderBlockedError (with holderId + reason) for a blocked holder', async () => {
    await expect(
      transaction((txn) => assertHolderNotBlocked(txn, BLOCKED_HOLDER_ID)),
    ).rejects.toMatchObject({
      name: 'HolderBlockedError',
      holderId: BLOCKED_HOLDER_ID,
      blockedReason: BLOCK_REASON,
    });
  });

  it('passes for a holder with no accountability row (not blocked)', async () => {
    await expect(
      transaction((txn) => assertHolderNotBlocked(txn, UNBLOCKED_HOLDER_ID)),
    ).resolves.toBeUndefined();
  });

  it('aborts the issue txn before promoteSerial — serial stays in_stock, zero events', async () => {
    let caught: unknown;
    try {
      await transaction(async (txn) => {
        // Same order as the picking handler: guard first, then promoteSerial.
        await assertHolderNotBlocked(txn, BLOCKED_HOLDER_ID);
        await promoteSerial(txn.client, {
          serialId: issueSerialId,
          toStatus: 'issued',
          toHolderId: BLOCKED_HOLDER_ID,
          sourceTable: 'stock_pickings',
          sourceId: 'facade00-0000-0000-0000-000000000041',
          actorStaffId: null,
          payload: { picking_number: 'PICK-TRACK41-001' },
        });
      });
    } catch (e) {
      caught = e;
    }

    // The guard threw (not a promoteSerial error), so promotion was never reached.
    expect(caught).toBeInstanceOf(HolderBlockedError);

    const serial = await pool.query<{ status: string; holder_id: string | null }>(
      `SELECT status, holder_id FROM stock_serials WHERE id = $1`,
      [issueSerialId],
    );
    expect(serial.rows[0]?.status).toBe('in_stock');
    expect(serial.rows[0]?.holder_id).toBeNull();

    const events = await pool.query<{ id: string }>(
      `SELECT id FROM stock_serial_events WHERE serial_id = $1`,
      [issueSerialId],
    );
    expect(events.rows).toHaveLength(0);
  });
});
