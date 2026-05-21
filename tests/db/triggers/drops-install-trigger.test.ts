/**
 * tests/db/triggers/drops-install-trigger.test.ts
 *
 * Integration tests for migration 366: emit_serial_event_on_drop_install
 * (drops AFTER UPDATE OF ont_serial).
 *
 * Background: Trigger 2 (qa_photo_reviews.ont_serial_scanned) is dormant in
 * prod — that column is NULL in all 8,299 rows. The canonical install fact is
 * drops.ont_serial (17,722 populated rows). This trigger emits the real events.
 *
 * Seed fixtures used:
 *   SERIAL_ID_1 (ALCL12345001) — status='available'
 *   DROP_ID     (DR0000001)     — existing drop, ont_serial=NULL in seed
 *   DROP_ID_2   (DR0000002)     — second drop, ont_serial=NULL in seed
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import {
  resetState,
  SERIAL_ID_1,
  DROP_ID,
} from './_helpers';

const URL = process.env.DATABASE_URL_TEST!;
const DROP_ID_2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

async function resetDrop(pool: Pool, dropId: string): Promise<void> {
  await pool.query(
    `UPDATE drops SET ont_serial = NULL, installed_at = NULL WHERE id = $1`,
    [dropId],
  );
}

describe('Trigger: emit_serial_event_on_drop_install (drops AFTER UPDATE OF ont_serial)', () => {
  it('happy path: UPDATE drops.ont_serial NULL→serial emits event + serial becomes installed', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);
      await resetDrop(pool, DROP_ID);

      // Trigger fires on UPDATE OF ont_serial from NULL → known serial.
      await pool.query(
        `UPDATE drops SET ont_serial = 'ALCL12345001' WHERE id = $1`,
        [DROP_ID],
      );

      const ev = await pool.query(
        `SELECT event_type, from_state, to_state, source_table, source_id, payload
         FROM   stock_serial_events
         WHERE  serial_id = $1`,
        [SERIAL_ID_1],
      );
      expect(ev.rows.length).toBeGreaterThanOrEqual(1);
      const row = ev.rows.find((r: { event_type: string }) => r.event_type === 'installed_at_drop');
      expect(row).toBeTruthy();
      expect(row.to_state).toBe('installed');
      expect(row.source_table).toBe('drops');
      expect(row.source_id).toBe(DROP_ID);
      expect(row.payload?.drop_number).toBe('DR0000001');

      const sr = await pool.query(
        `SELECT status, installed_at_drop_id, installed_at_drop_number
         FROM   stock_serials WHERE id = $1`,
        [SERIAL_ID_1],
      );
      expect(sr.rows[0].status).toBe('installed');
      expect(sr.rows[0].installed_at_drop_id).toBe(DROP_ID);
      expect(sr.rows[0].installed_at_drop_number).toBe('DR0000001');
    } finally {
      await resetDrop(pool, DROP_ID);
      await resetState(pool);
      await pool.end();
    }
  });

  it('no-op on terminal state: pre-set serial to faulty → UPDATE drops.ont_serial → status stays faulty, no status update', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);
      await resetDrop(pool, DROP_ID);

      // Pre-set to faulty — a terminal state the trigger must not overwrite.
      await pool.query(
        `UPDATE stock_serials SET status = 'faulty' WHERE id = $1`,
        [SERIAL_ID_1],
      );

      await pool.query(
        `UPDATE drops SET ont_serial = 'ALCL12345001' WHERE id = $1`,
        [DROP_ID],
      );

      const sr = await pool.query(
        `SELECT status, installed_at_drop_id FROM stock_serials WHERE id = $1`,
        [SERIAL_ID_1],
      );
      // Trigger must not overwrite terminal state.
      expect(sr.rows[0].status).toBe('faulty');
      expect(sr.rows[0].installed_at_drop_id).toBeNull();

      // An event may still be emitted (logging only) — but the status must not change.
      // The spec says: "never overwrite terminal states" for the status UPDATE path.
    } finally {
      await resetDrop(pool, DROP_ID);
      await resetState(pool);
      await pool.end();
    }
  });

  it('no-op on already-installed: installed_at_drop_id set → UPDATE drops.ont_serial → no overwrite', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);
      await resetDrop(pool, DROP_ID);
      await resetDrop(pool, DROP_ID_2);

      // Pre-install to DROP_ID_2 — simulates serial already installed at another drop.
      await pool.query(
        `UPDATE stock_serials
            SET status = 'installed',
                installed_at_drop_id = $1,
                installed_at_drop_number = 'DR0000002'
          WHERE id = $2`,
        [DROP_ID_2, SERIAL_ID_1],
      );

      // Now update DROP_ID's ont_serial to the same serial — should not overwrite.
      await pool.query(
        `UPDATE drops SET ont_serial = 'ALCL12345001' WHERE id = $1`,
        [DROP_ID],
      );

      const sr = await pool.query(
        `SELECT status, installed_at_drop_id, installed_at_drop_number
         FROM   stock_serials WHERE id = $1`,
        [SERIAL_ID_1],
      );
      // installed_at_drop_id must remain pointing to the original drop (DROP_ID_2).
      expect(sr.rows[0].installed_at_drop_id).toBe(DROP_ID_2);
      expect(sr.rows[0].installed_at_drop_number).toBe('DR0000002');
    } finally {
      await resetDrop(pool, DROP_ID);
      await resetDrop(pool, DROP_ID_2);
      await resetState(pool);
      await pool.end();
    }
  });

  it('unknown serial: UPDATE drops.ont_serial = NONEXISTENT → trigger emits NOTICE, no event, parent UPDATE succeeds', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);
      await resetDrop(pool, DROP_ID);

      // Parent UPDATE must succeed even when serial is not in stock_serials.
      const result = await pool.query(
        `UPDATE drops SET ont_serial = 'NONEXISTENT-SERIAL-XYZ' WHERE id = $1 RETURNING id`,
        [DROP_ID],
      );
      expect(result.rows).toHaveLength(1);  // parent UPDATE succeeded

      // No event emitted for unknown serial.
      const ev = await pool.query(
        `SELECT COUNT(*) FROM stock_serial_events
         WHERE  source_table = 'drops' AND source_id = $1`,
        [DROP_ID],
      );
      expect(Number(ev.rows[0].count)).toBe(0);
    } finally {
      await resetDrop(pool, DROP_ID);
      await resetState(pool);
      await pool.end();
    }
  });
});
