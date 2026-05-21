/**
 * tests/db/triggers/serial-events-picking.test.ts
 *
 * Trigger 1 (stock_pickings AFTER UPDATE OF status → done) integration tests.
 * Covers: issue branch, transfer branch, accountability counter, no-downgrade guard.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import {
  resetState, clearEvents,
  SERIAL_ID_1, STAFF_ID, STOCK_ITEM_ID, SOURCE_LOC, DEST_LOC,
  uniquePickingNumber,
} from './_helpers';

const URL = process.env.DATABASE_URL_TEST!;

describe('Trigger 1: stock_pickings status→done (issue branch)', () => {
  it('emits an issued event and updates serial status to issued', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings
          (picking_number, picking_type, status,
           source_location_id, destination_location_id, technician_id)
        VALUES ($1, 'issue', 'planned', $2, $3, $4)
        RETURNING id`,
        [uniquePickingNumber(), SOURCE_LOC, DEST_LOC, STAFF_ID]);

      await pool.query(`
        INSERT INTO stock_picking_lines
          (picking_id, stock_item_id, serial_ids, serial_number)
        VALUES ($1, $2, ARRAY[$3::uuid], 'ALCL12345001')`,
        [pickId, STOCK_ITEM_ID, SERIAL_ID_1]);

      await pool.query(
        `UPDATE stock_pickings SET status='done', done_at=NOW() WHERE id=$1`,
        [pickId]);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id, actor_staff_id, payload
        FROM   stock_serial_events
        WHERE  serial_id = $1`, [SERIAL_ID_1]);

      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].event_type).toBe('issued');
      expect(ev.rows[0].to_state).toBe('issued');
      expect(ev.rows[0].source_table).toBe('stock_pickings');
      expect(ev.rows[0].source_id).toBe(pickId);
      expect(ev.rows[0].actor_staff_id).toBe(STAFF_ID);
      expect(ev.rows[0].payload?.picking_type).toBe('issue');

      const sr = await pool.query(
        `SELECT status FROM stock_serials WHERE id=$1`, [SERIAL_ID_1]);
      expect(sr.rows[0].status).toBe('issued');
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });
});

describe('Trigger 1: stock_pickings status→done (transfer branch)', () => {
  it('emits a transferred event with to_state=in_transit', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings
          (picking_number, picking_type, status,
           source_location_id, destination_location_id, technician_id)
        VALUES ($1, 'transfer', 'planned', $2, $3, $4)
        RETURNING id`,
        [uniquePickingNumber(), SOURCE_LOC, DEST_LOC, STAFF_ID]);

      await pool.query(`
        INSERT INTO stock_picking_lines
          (picking_id, stock_item_id, serial_ids, serial_number)
        VALUES ($1, $2, ARRAY[$3::uuid], 'ALCL12345001')`,
        [pickId, STOCK_ITEM_ID, SERIAL_ID_1]);

      await pool.query(
        `UPDATE stock_pickings SET status='done', done_at=NOW() WHERE id=$1`,
        [pickId]);

      const ev = await pool.query(`
        SELECT event_type, to_state, payload
        FROM   stock_serial_events WHERE serial_id=$1`, [SERIAL_ID_1]);
      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].event_type).toBe('transferred');
      expect(ev.rows[0].to_state).toBe('in_transit');
      expect(ev.rows[0].payload?.picking_type).toBe('transfer');

      const sr = await pool.query(
        `SELECT status FROM stock_serials WHERE id=$1`, [SERIAL_ID_1]);
      expect(sr.rows[0].status).toBe('in_transit');
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });
});

describe('Trigger 1: contractor_stock_accountability counter', () => {
  it('increments total_issued_count on contractor picking done (provides contractor_name)', async () => {
    const pool = new Pool({ connectionString: URL });
    const testContractor = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    try {
      await resetState(pool);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings
          (picking_number, picking_type, status,
           source_location_id, destination_location_id,
           technician_id, contractor_id, contractor_name)
        VALUES ($1, 'issue', 'planned', $2, $3, $4, $5, $6)
        RETURNING id`,
        [uniquePickingNumber(), SOURCE_LOC, DEST_LOC, STAFF_ID, testContractor, 'Test Contractor LLC']);

      await pool.query(`
        INSERT INTO stock_picking_lines
          (picking_id, stock_item_id, serial_ids, serial_number)
        VALUES ($1, $2, ARRAY[$3::uuid], 'ALCL12345001')`,
        [pickId, STOCK_ITEM_ID, SERIAL_ID_1]);

      await pool.query(
        `UPDATE stock_pickings SET status='done', done_at=NOW() WHERE id=$1`,
        [pickId]);

      const acc = await pool.query(`
        SELECT total_issued_count, contractor_name
        FROM   contractor_stock_accountability
        WHERE  contractor_id = $1`, [testContractor]);

      expect(acc.rows).toHaveLength(1);
      expect(acc.rows[0].total_issued_count).toBe(1);
      expect(acc.rows[0].contractor_name).toBe('Test Contractor LLC');
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });
});

describe('Trigger 1: no-downgrade guard', () => {
  it('does NOT overwrite status when serial is faulty', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);
      await pool.query(
        `UPDATE stock_serials SET status='faulty' WHERE id=$1`, [SERIAL_ID_1]);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings
          (picking_number, picking_type, status,
           source_location_id, destination_location_id, technician_id)
        VALUES ($1, 'issue', 'planned', $2, $3, $4)
        RETURNING id`,
        [uniquePickingNumber(), SOURCE_LOC, DEST_LOC, STAFF_ID]);

      await pool.query(`
        INSERT INTO stock_picking_lines
          (picking_id, stock_item_id, serial_ids, serial_number)
        VALUES ($1, $2, ARRAY[$3::uuid], 'ALCL12345001')`,
        [pickId, STOCK_ITEM_ID, SERIAL_ID_1]);

      await pool.query(
        `UPDATE stock_pickings SET status='done', done_at=NOW() WHERE id=$1`,
        [pickId]);

      // Event was emitted (trigger ran), but status update was blocked by guard.
      const ev = await pool.query(
        `SELECT event_type FROM stock_serial_events WHERE serial_id=$1`, [SERIAL_ID_1]);
      expect(ev.rows.length).toBeGreaterThanOrEqual(1);

      const sr = await pool.query(
        `SELECT status FROM stock_serials WHERE id=$1`, [SERIAL_ID_1]);
      expect(sr.rows[0].status).toBe('faulty');
    } finally {
      await resetState(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });
});
