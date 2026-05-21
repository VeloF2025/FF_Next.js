/**
 * tests/db/triggers/serial-events-returns.test.ts
 *
 * Trigger 4 (stock_returns AFTER INSERT) + Trigger 4b (stock_return_lines
 * AFTER INSERT) + Trigger 5 (stock_return_lines AFTER UPDATE OF disposition)
 * integration tests.
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import {
  resetState,
  SERIAL_ID_1, SERIAL_ID_2, STAFF_ID, STOCK_ITEM_ID,
  uniqueReturnNumber,
} from './_helpers';

const URL = process.env.DATABASE_URL_TEST!;

describe('Trigger 4: stock_returns AFTER INSERT (no-op when no lines yet)', () => {
  it('is a safe no-op when the return is inserted before any lines', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);

      const { rows } = await pool.query(`
        INSERT INTO stock_returns
          (return_number, status, returned_by_id, return_date)
        VALUES ($1, 'pending', $2, NOW())
        RETURNING id`, [uniqueReturnNumber(), STAFF_ID]);

      expect(rows).toHaveLength(1);

      // No lines yet → trigger 4 emits no events.
      const ev = await pool.query(`
        SELECT COUNT(*) FROM stock_serial_events
        WHERE source_table='stock_returns' AND source_id=$1`, [rows[0].id]);
      expect(Number(ev.rows[0].count)).toBe(0);
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });
});

describe('Trigger 4b: stock_return_lines AFTER INSERT', () => {
  it('emits a returned event when a line is inserted after the return header', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);

      const { rows: [{ id: retId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_returns
          (return_number, status, returned_by_id, return_date)
        VALUES ($1, 'pending', $2, NOW())
        RETURNING id`, [uniqueReturnNumber(), STAFF_ID]);

      await pool.query(`
        INSERT INTO stock_return_lines
          (return_id, stock_item_id, serial_id, serial_number)
        VALUES ($1, $2, $3, 'ALCL12345002')`, [retId, STOCK_ITEM_ID, SERIAL_ID_2]);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id, actor_staff_id
        FROM   stock_serial_events
        WHERE  serial_id = $1`, [SERIAL_ID_2]);

      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].event_type).toBe('returned');
      expect(ev.rows[0].to_state).toBe('returned');
      expect(ev.rows[0].source_table).toBe('stock_returns');
      expect(ev.rows[0].source_id).toBe(retId);
      expect(ev.rows[0].actor_staff_id).toBe(STAFF_ID);

      const sr = await pool.query(
        `SELECT status FROM stock_serials WHERE id=$1`, [SERIAL_ID_2]);
      expect(sr.rows[0].status).toBe('returned');
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });
});

describe('Trigger 5: stock_return_lines disposition update', () => {
  it('emits sent_to_repair event when disposition set to repair', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);

      const { rows: [{ id: retId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_returns
          (return_number, status, returned_by_id, return_date)
        VALUES ($1, 'pending', $2, NOW())
        RETURNING id`, [uniqueReturnNumber(), STAFF_ID]);

      const { rows: [{ id: lineId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_return_lines
          (return_id, stock_item_id, serial_id, serial_number, disposition)
        VALUES ($1, $2, $3, 'ALCL12345002', NULL)
        RETURNING id`, [retId, STOCK_ITEM_ID, SERIAL_ID_2]);

      await pool.query(
        `UPDATE stock_return_lines SET disposition='repair' WHERE id=$1`, [lineId]);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id
        FROM   stock_serial_events
        WHERE  serial_id=$1 AND event_type='sent_to_repair'`, [SERIAL_ID_2]);

      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].to_state).toBe('in_repair');
      expect(ev.rows[0].source_table).toBe('stock_return_lines');
      expect(ev.rows[0].source_id).toBe(lineId);

      const sr = await pool.query(
        `SELECT status FROM stock_serials WHERE id=$1`, [SERIAL_ID_2]);
      expect(sr.rows[0].status).toBe('in_repair');
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });

  it('restock path does NOT un-scrap a scrapped serial', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetState(pool);
      // Pre-scrap SERIAL_ID_1.
      await pool.query(
        `UPDATE stock_serials SET status='scrapped' WHERE id=$1`, [SERIAL_ID_1]);

      const { rows: [{ id: retId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_returns
          (return_number, status, returned_by_id, return_date)
        VALUES ($1, 'pending', $2, NOW())
        RETURNING id`, [uniqueReturnNumber(), STAFF_ID]);

      const { rows: [{ id: lineId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_return_lines
          (return_id, stock_item_id, serial_id, serial_number, disposition)
        VALUES ($1, $2, $3, 'ALCL12345001', NULL)
        RETURNING id`, [retId, STOCK_ITEM_ID, SERIAL_ID_1]);

      await pool.query(
        `UPDATE stock_return_lines SET disposition='restock' WHERE id=$1`, [lineId]);

      // Event is emitted (audit trail), but status stays 'scrapped'.
      const sr = await pool.query(
        `SELECT status FROM stock_serials WHERE id=$1`, [SERIAL_ID_1]);
      expect(sr.rows[0].status).toBe('scrapped');
    } finally {
      await resetState(pool);
      await pool.end();
    }
  });
});
