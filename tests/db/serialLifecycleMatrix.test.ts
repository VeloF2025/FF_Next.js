/**
 * tests/db/serialLifecycleMatrix.test.ts
 *
 * Full transition-matrix coverage for mig 387 lifecycle triggers.
 * 17 forward ALLOWED + 3 ILLEGAL (FF001) + 2 HOLDER_MISMATCH (FF002) = 22 tests.
 *
 * Track 2.4 additions: mig 387 matrix extended with OES cascade paths:
 *   in_stock → installed       (was ILLEGAL: "skips issued")
 *   available → installed      (new: legacy pre-backfill direct install)
 *   allocated_to_project → installed  (new: direct install from project allocation)
 *
 * Run: npx vitest run --config vitest.db.sprinte.config.ts \
 *        tests/db/serialLifecycleMatrix.test.ts
 *
 * Each test seeds a fresh serial via bypass INSERT, calls promoteSerial, and
 * asserts the status + emitted event. Cleanup runs in try/finally per case;
 * afterAll sweeps any leaks by serial_number prefix MATRIX-ALCLB-*.
 *
 * Holder note: mig 383 CHECK allows only staff/contractor/external_person.
 * Seed staff holder ee000000-...-001 is from sprint-e-holders-seed.sql.
 * Most statuses need holder_id IS NULL; `issued` needs a staff/contractor holder.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  promoteSerial,
  LifecycleViolationError,
  HolderMismatchError,
  type SerialStatus,
} from '@/modules/procurement/field-stock/services/serialLifecycle';

// Fixed UUIDs from seed files
const STAFF_HOLDER_ID = 'ee000000-0000-0000-0000-000000000001';
const STOCK_ITEM_ID   = '55555555-5555-5555-5555-555555555555';
const SOURCE_TABLE    = 'matrix_test';

// ============================================================================
// Transition definitions
// ============================================================================

interface AllowedCase {
  from: SerialStatus;
  to: SerialStatus;
  expectedEventType: string;
  seedHolderId: string | null;
  /** undefined = leave holder unchanged; null = explicitly clear to NULL */
  toHolderId?: string | null;
}

interface IllegalCase {
  from: SerialStatus;
  to: SerialStatus;
  seedHolderId: string | null;
}

interface HolderMismatchCase {
  from: SerialStatus;
  to: SerialStatus;
  seedHolderId: string | null;
  /** undefined = leave holder unchanged; null = clear to NULL */
  toHolderId?: string | null;
  /** Allowed forward transition? If true, only the holder-validate trigger should fire. */
  transitionAllowed: boolean;
}

// 17 forward transitions mirroring stock_serial_status_transitions (excludes
// null → in_stock INSERT case covered by Task 1.3).
// Track 2.4 added 3 OES cascade paths: in_stock/available/allocated_to_project → installed.
const ALLOWED: AllowedCase[] = [
  { from: 'in_stock',            to: 'allocated_to_project', expectedEventType: 'allocated',             seedHolderId: null },
  { from: 'allocated_to_project',to: 'issued',               expectedEventType: 'issued_to_tech',        seedHolderId: null,           toHolderId: STAFF_HOLDER_ID },
  { from: 'in_stock',            to: 'issued',               expectedEventType: 'issued_to_tech',        seedHolderId: null,           toHolderId: STAFF_HOLDER_ID },
  { from: 'issued',              to: 'installed',            expectedEventType: 'installed_at_drop',     seedHolderId: STAFF_HOLDER_ID,toHolderId: null },
  // OES cascade paths (Track 2.4 — mig 387 matrix extension)
  { from: 'in_stock',            to: 'installed',            expectedEventType: 'installed_at_drop',     seedHolderId: null,           toHolderId: null },
  { from: 'available',           to: 'installed',            expectedEventType: 'installed_at_drop',     seedHolderId: null,           toHolderId: null },
  { from: 'allocated_to_project',to: 'installed',            expectedEventType: 'installed_at_drop',     seedHolderId: null,           toHolderId: null },
  { from: 'installed',           to: 'activated',            expectedEventType: 'activated',             seedHolderId: null },
  { from: 'installed',           to: 'faulty',               expectedEventType: 'marked_faulty',         seedHolderId: null },
  { from: 'activated',           to: 'faulty',               expectedEventType: 'marked_faulty',         seedHolderId: null },
  { from: 'issued',              to: 'faulty',               expectedEventType: 'marked_faulty',         seedHolderId: STAFF_HOLDER_ID,toHolderId: null },
  { from: 'installed',           to: 'returned',             expectedEventType: 'returned_to_warehouse', seedHolderId: null },
  { from: 'activated',           to: 'returned',             expectedEventType: 'returned_to_warehouse', seedHolderId: null },
  { from: 'faulty',              to: 'returned',             expectedEventType: 'returned_to_warehouse', seedHolderId: null },
  { from: 'returned',            to: 'in_stock',             expectedEventType: 'restocked',             seedHolderId: null },
  { from: 'returned',            to: 'scrapped',             expectedEventType: 'scrapped',              seedHolderId: null },
  { from: 'faulty',              to: 'scrapped',             expectedEventType: 'scrapped',              seedHolderId: null },
];

// 3 illegal transitions — holder valid for from-status so status-validate fires.
// Track 2.4 removed in_stock → installed (now in the matrix via OES cascade row).
const ILLEGAL: IllegalCase[] = [
  { from: 'activated', to: 'in_stock',  seedHolderId: null }, // backwards
  { from: 'scrapped',  to: 'in_stock',  seedHolderId: null }, // terminal state
  { from: 'installed', to: 'in_stock',  seedHolderId: null }, // backwards skip
];

// Holder-mismatch cases (FF002). Trigger ordering is alphabetical so
// trg_stock_serial_holder_validate_t fires BEFORE trg_stock_serial_status_validate_t.
// Case 1 uses an ALLOWED forward transition with a bad holder so only FF002
// can fire. Case 2 uses an allowed transition but leaves holder NULL when the
// to-status requires a person holder (`issued` requires staff/contractor).
const HOLDER_MISMATCH: HolderMismatchCase[] = [
  {
    // (installed, staff) is NOT in stock_serial_status_holder_pairs.
    // Transition issued → installed IS in the matrix, so status-validate would pass.
    from: 'issued', to: 'installed',
    seedHolderId: STAFF_HOLDER_ID,
    toHolderId: STAFF_HOLDER_ID,        // keep the staff holder past install
    transitionAllowed: true,
  },
  {
    // (issued, NULL) is NOT in pairs — issued requires staff or contractor.
    // Transition in_stock → issued IS in the matrix.
    from: 'in_stock', to: 'issued',
    seedHolderId: null,
    toHolderId: null,                   // explicitly NULL
    transitionAllowed: true,
  },
];

// ============================================================================
// Helpers
// ============================================================================

/** Insert at any status by bypassing trigger validation. */
async function seedAt(
  pool: Pool,
  serialNumber: string,
  status: string,
  holderId: string | null,
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ff.bypass_validation = 'true'`);
    const r = await client.query(
      `INSERT INTO stock_serials (serial_number, stock_item_id, status, holder_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [serialNumber, STOCK_ITEM_ID, status, holderId],
    );
    await client.query('COMMIT');
    return r.rows[0].id as string;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Delete serial and its events (cleanup runs in finally blocks). */
async function purge(pool: Pool, id: string): Promise<void> {
  await pool.query('DELETE FROM stock_serial_events WHERE serial_id = $1', [id]);
  await pool.query('DELETE FROM stock_serials WHERE id = $1', [id]);
}

// ============================================================================
// Test suite
// ============================================================================

describe('serial lifecycle transition matrix', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });

  afterAll(async () => {
    // Belt-and-braces sweep for any leaked rows
    await pool.query(
      `DELETE FROM stock_serial_events WHERE serial_id IN
        (SELECT id FROM stock_serials WHERE serial_number LIKE 'MATRIX-ALCLB-%')`,
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE 'MATRIX-ALCLB-%'`);
    await pool.end();
  });

  // --------------------------------------------------------------------------
  // ALLOWED — 14 forward cases
  // --------------------------------------------------------------------------

  ALLOWED.forEach(({ from, to, expectedEventType, seedHolderId, toHolderId }, idx) => {
    const n = String(idx + 1).padStart(3, '0');
    const serialNumber = `MATRIX-ALCLB-${n}`;
    const sourceId     = `aa000000-0000-0000-0000-${n.padStart(12, '0')}`;

    it(`allows ${from} → ${to} (emits ${expectedEventType})`, async () => {
      const serialId = await seedAt(pool, serialNumber, from, seedHolderId);
      try {
        await promoteSerial(pool, {
          serialId,
          toStatus: to,
          ...(toHolderId !== undefined ? { toHolderId } : {}),
          sourceTable: SOURCE_TABLE,
          sourceId,
          payload: { case: `allow_${from}_${to}` },
        });

        const serial = await pool.query(
          `SELECT status FROM stock_serials WHERE id = $1`, [serialId],
        );
        expect(serial.rows[0].status, `status should be '${to}'`).toBe(to);

        const event = await pool.query(
          `SELECT event_type, from_state, to_state, source_table
             FROM stock_serial_events WHERE serial_id = $1
             ORDER BY occurred_at DESC LIMIT 1`,
          [serialId],
        );
        expect(event.rows.length, 'event row must exist').toBe(1);
        expect(event.rows[0].event_type,   'event_type mismatch').toBe(expectedEventType);
        expect(event.rows[0].from_state,   'from_state mismatch').toBe(from);
        expect(event.rows[0].to_state,     'to_state mismatch').toBe(to);
        expect(event.rows[0].source_table, 'source_table mismatch').toBe(SOURCE_TABLE);
      } finally {
        await purge(pool, serialId);
      }
    });
  });

  // --------------------------------------------------------------------------
  // ILLEGAL — 4 rejection cases
  // --------------------------------------------------------------------------

  ILLEGAL.forEach(({ from, to, seedHolderId }, idx) => {
    const n = String(ALLOWED.length + idx + 1).padStart(3, '0');
    const serialNumber = `MATRIX-ALCLB-${n}`;
    const sourceId     = `bb000000-0000-0000-0000-${n.padStart(12, '0')}`;

    it(`rejects ${from} → ${to} with LifecycleViolationError`, async () => {
      const serialId = await seedAt(pool, serialNumber, from, seedHolderId);
      try {
        await expect(
          promoteSerial(pool, {
            serialId,
            toStatus: to,
            sourceTable: SOURCE_TABLE,
            sourceId,
            payload: { case: `illegal_${from}_${to}` },
          }),
        ).rejects.toBeInstanceOf(LifecycleViolationError);

        const serial = await pool.query(
          `SELECT status FROM stock_serials WHERE id = $1`, [serialId],
        );
        expect(
          serial.rows[0].status,
          `status must remain '${from}' after rejection`,
        ).toBe(from);
      } finally {
        await purge(pool, serialId);
      }
    });
  });

  // --------------------------------------------------------------------------
  // HOLDER MISMATCH — FF002 rejection cases (covers trg_stock_serial_holder_validate)
  // --------------------------------------------------------------------------

  HOLDER_MISMATCH.forEach(({ from, to, seedHolderId, toHolderId, transitionAllowed }, idx) => {
    const n = String(ALLOWED.length + ILLEGAL.length + idx + 1).padStart(3, '0');
    const serialNumber = `MATRIX-ALCLB-${n}`;
    const sourceId     = `cc000000-0000-0000-0000-${n.padStart(12, '0')}`;
    const holderLabel  = toHolderId === null ? 'NULL' : 'staff';

    it(`rejects ${from} → ${to} (holder=${holderLabel}) with HolderMismatchError`, async () => {
      const serialId = await seedAt(pool, serialNumber, from, seedHolderId);
      try {
        await expect(
          promoteSerial(pool, {
            serialId,
            toStatus: to,
            ...(toHolderId !== undefined ? { toHolderId } : {}),
            sourceTable: SOURCE_TABLE,
            sourceId,
            payload: { case: `holder_mismatch_${from}_${to}`, transitionAllowed },
          }),
        ).rejects.toBeInstanceOf(HolderMismatchError);

        const serial = await pool.query(
          `SELECT status, holder_id FROM stock_serials WHERE id = $1`, [serialId],
        );
        expect(
          serial.rows[0].status,
          `status must remain '${from}' after holder rejection`,
        ).toBe(from);
        expect(
          serial.rows[0].holder_id,
          `holder_id must remain seeded value after rejection`,
        ).toBe(seedHolderId);
      } finally {
        await purge(pool, serialId);
      }
    });
  });
});
