/**
 * tests/db/triggers/serial-events.test.ts
 *
 * Integration tests for the 5 serial-event PostgreSQL triggers (migration 364).
 * Requires global-setup.ts to have already applied seed.sql + migrations 362+364.
 *
 * Reset helpers are called at the START of each test AND in every finally block
 * to prevent state leaks (pattern established in PR-3/4/5).
 */
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

const URL = process.env.DATABASE_URL_TEST!;

// Known UUIDs from seed.sql
const SERIAL_ID_1   = '77777777-7777-7777-7777-777777777777'; // available
const SERIAL_ID_2   = '88888888-8888-8888-8888-888888888888'; // issued
const DROP_ID       = '44444444-4444-4444-4444-444444444444';
const STAFF_ID      = '33333333-3333-3333-3333-333333333333';
const SEED_PICK_ID  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function clearEvents(pool: Pool) {
  await pool.query(`DELETE FROM stock_serial_events
    WHERE serial_id IN ($1,$2)`, [SERIAL_ID_1, SERIAL_ID_2]);
}

async function resetSeedSerial(pool: Pool) {
  await pool.query(`
    UPDATE stock_serials
    SET    status = 'available', installed_at_drop_id = NULL,
           activated_at_olt_id = NULL, current_holder_staff_id = NULL,
           updated_at = NOW()
    WHERE  id = $1`, [SERIAL_ID_1]);
  await pool.query(`
    UPDATE stock_serials
    SET    status = 'issued', installed_at_drop_id = NULL,
           activated_at_olt_id = NULL, current_holder_staff_id = $1,
           updated_at = NOW()
    WHERE  id = $2`, [STAFF_ID, SERIAL_ID_2]);
  await pool.query(`DELETE FROM oes_pp_data`);
  // Only delete qa_photo_reviews rows inserted by trigger tests (ALCL12345001).
  // The seed row for ALCL12345002/DR0000001 must remain for backfill B tests.
  await pool.query(`DELETE FROM qa_photo_reviews WHERE ont_serial = $1`, ['ALCL12345001']);
  await pool.query(`
    DELETE FROM stock_return_lines
    WHERE stock_serial_id IN ($1,$2)`, [SERIAL_ID_1, SERIAL_ID_2]);
  // Only delete test-inserted stock_returns (seed has none with known IDs).
  await pool.query(`DELETE FROM stock_returns WHERE id IN (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid)`);
  await pool.query(`
    DELETE FROM stock_picking_lines spl
    USING  stock_pickings sp
    WHERE  spl.picking_id = sp.id
      AND  sp.id <> $1
      AND  spl.stock_serial_id IN ($2,$3)`, [SEED_PICK_ID, SERIAL_ID_1, SERIAL_ID_2]);
  await pool.query(`
    DELETE FROM stock_pickings
    WHERE  id <> $1 AND staff_id = $2`, [SEED_PICK_ID, STAFF_ID]);
  await pool.query(`DELETE FROM contractor_stock_accountability`);
}

// ---------------------------------------------------------------------------
// Test 1: Picking → 'issued' event emitted when picking goes 'done'
// ---------------------------------------------------------------------------
describe('Trigger 1: stock_pickings status→done', () => {
  it('emits an issued event and updates serial status to issued', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings (picking_type, status, staff_id)
        VALUES ('issue', 'planned', $1) RETURNING id`, [STAFF_ID]);

      await pool.query(`
        INSERT INTO stock_picking_lines (picking_id, stock_serial_id, serial_number)
        VALUES ($1, $2, 'ALCL12345001')`, [pickId, SERIAL_ID_1]);

      await pool.query(`
        UPDATE stock_pickings SET status = 'done', done_at = NOW() WHERE id = $1`,
        [pickId]);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id
        FROM   stock_serial_events
        WHERE  serial_id = $1`, [SERIAL_ID_1]);

      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].event_type).toBe('issued');
      expect(ev.rows[0].to_state).toBe('issued');
      expect(ev.rows[0].source_table).toBe('stock_pickings');
      expect(ev.rows[0].source_id).toBe(pickId);

      const sr = await pool.query(`SELECT status FROM stock_serials WHERE id = $1`, [SERIAL_ID_1]);
      expect(sr.rows[0].status).toBe('issued');
    } finally {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: QA install → 'installed_at_drop' event emitted
// ---------------------------------------------------------------------------
describe('Trigger 2: qa_photo_reviews AFTER INSERT', () => {
  it('emits installed_at_drop event and sets serial.installed_at_drop_id', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);

      const { rows: [{ id: qaId }] } = await pool.query<{ id: string }>(`
        INSERT INTO qa_photo_reviews (drop_id, drop_number, ont_serial)
        VALUES ($1, 'DR0000001', 'ALCL12345001')
        RETURNING id`, [DROP_ID]);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id
        FROM   stock_serial_events
        WHERE  serial_id = $1`, [SERIAL_ID_1]);

      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].event_type).toBe('installed_at_drop');
      expect(ev.rows[0].to_state).toBe('installed');
      expect(ev.rows[0].source_table).toBe('qa_photo_reviews');
      expect(ev.rows[0].source_id).toBe(qaId);

      const sr = await pool.query(`
        SELECT status, installed_at_drop_id FROM stock_serials WHERE id = $1`,
        [SERIAL_ID_1]);
      expect(sr.rows[0].status).toBe('installed');
      expect(sr.rows[0].installed_at_drop_id).toBe(DROP_ID);
    } finally {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 3: Return line disposition → 'sent_to_repair' event
// ---------------------------------------------------------------------------
describe('Trigger 5: stock_return_lines disposition update', () => {
  it('emits sent_to_repair event and sets serial status to in_repair', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);

      const { rows: [{ id: retId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_returns (status, staff_id)
        VALUES ('pending_inspection', $1) RETURNING id`, [STAFF_ID]);

      const { rows: [{ id: lineId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_return_lines
          (return_id, stock_serial_id, serial_number, disposition)
        VALUES ($1, $2, 'ALCL12345002', NULL)
        RETURNING id`, [retId, SERIAL_ID_2]);

      await pool.query(`
        UPDATE stock_return_lines SET disposition = 'repair' WHERE id = $1`, [lineId]);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id
        FROM   stock_serial_events
        WHERE  serial_id = $1 AND event_type = 'sent_to_repair'`, [SERIAL_ID_2]);

      expect(ev.rows).toHaveLength(1);
      expect(ev.rows[0].to_state).toBe('in_repair');
      expect(ev.rows[0].source_table).toBe('stock_return_lines');
      expect(ev.rows[0].source_id).toBe(lineId);

      const sr = await pool.query(`SELECT status FROM stock_serials WHERE id = $1`, [SERIAL_ID_2]);
      expect(sr.rows[0].status).toBe('in_repair');
    } finally {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });

  it('does not un-scrap a scrapped serial on restock disposition', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      // Force scrapped state on ALCL12345002.
      await pool.query(
        `UPDATE stock_serials SET status='scrapped' WHERE serial_number='ALCL12345002'`);
      const retId = '11111111-2222-2222-2222-111111111111';
      await pool.query(`INSERT INTO stock_returns (id, status, staff_id)
        VALUES ($1, 'pending_inspection', $2)`, [retId, STAFF_ID]);
      const lineId = '22222222-3333-3333-3333-222222222222';
      await pool.query(`INSERT INTO stock_return_lines
        (id, return_id, stock_serial_id, serial_number) VALUES
        ($1, $2, $3, 'ALCL12345002')`, [lineId, retId, SERIAL_ID_2]);
      // Apply restock disposition — must NOT un-scrap.
      await pool.query(
        `UPDATE stock_return_lines SET disposition='restock' WHERE id=$1`,
        [lineId]);
      const s = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number='ALCL12345002'`);
      expect(s.rows[0].status).toBe('scrapped');
    } finally {
      await pool.query(`DELETE FROM stock_return_lines WHERE id='22222222-3333-3333-3333-222222222222'`);
      await pool.query(`DELETE FROM stock_returns WHERE id='11111111-2222-2222-2222-111111111111'`);
      await clearEvents(pool);
      await resetSeedSerial(pool);
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: Accountability counter increments on picking done
// ---------------------------------------------------------------------------
describe('Trigger 1: contractor_stock_accountability counter', () => {
  it('increments total_issued_count on contractor picking done', async () => {
    const pool = new Pool({ connectionString: URL });
    const testContractor = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings (picking_type, status, staff_id, contractor_id)
        VALUES ('issue', 'planned', $1, $2) RETURNING id`, [STAFF_ID, testContractor]);

      await pool.query(`
        INSERT INTO stock_picking_lines (picking_id, stock_serial_id, serial_number)
        VALUES ($1, $2, 'ALCL12345001')`, [pickId, SERIAL_ID_1]);

      await pool.query(`
        UPDATE stock_pickings SET status = 'done', done_at = NOW() WHERE id = $1`, [pickId]);

      const acc = await pool.query(`
        SELECT total_issued_count
        FROM   contractor_stock_accountability
        WHERE  contractor_id = $1`, [testContractor]);

      expect(acc.rows).toHaveLength(1);
      expect(acc.rows[0].total_issued_count).toBe(1);
    } finally {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 5: No-downgrade guard — faulty serial must NOT be overwritten
// ---------------------------------------------------------------------------
describe('Trigger 1: no-downgrade guard', () => {
  it('does NOT overwrite status when serial is faulty', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);

      // Mark SERIAL_ID_1 as faulty.
      await pool.query(`UPDATE stock_serials SET status = 'faulty' WHERE id = $1`, [SERIAL_ID_1]);

      const { rows: [{ id: pickId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings (picking_type, status, staff_id)
        VALUES ('issue', 'planned', $1) RETURNING id`, [STAFF_ID]);

      await pool.query(`
        INSERT INTO stock_picking_lines (picking_id, stock_serial_id, serial_number)
        VALUES ($1, $2, 'ALCL12345001')`, [pickId, SERIAL_ID_1]);

      // Mark done — trigger fires, event IS emitted but serial stays faulty.
      await pool.query(`
        UPDATE stock_pickings SET status = 'done', done_at = NOW() WHERE id = $1`, [pickId]);

      const sr = await pool.query(`SELECT status FROM stock_serials WHERE id = $1`, [SERIAL_ID_1]);
      // Status must NOT have been downgraded to 'issued'.
      expect(sr.rows[0].status).toBe('faulty');

      // Event was still inserted (trigger ran, but UPDATE WHERE guard blocked status write).
      const ev = await pool.query(`
        SELECT event_type FROM stock_serial_events
        WHERE  serial_id = $1`, [SERIAL_ID_1]);
      expect(ev.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Test 6: Trigger failure does NOT abort the parent transaction
// ---------------------------------------------------------------------------
describe('Trigger safety: EXCEPTION guard', () => {
  it('parent INSERT succeeds even when qa_photo_reviews serial is unknown', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await clearEvents(pool);

      // Insert qa_photo_reviews for a serial not in stock_serials.
      // Trigger raises NOTICE but must NOT abort the INSERT.
      const { rows } = await pool.query(`
        INSERT INTO qa_photo_reviews (drop_id, drop_number, ont_serial)
        VALUES ($1, 'DR0000001', 'UNKNOWN-SERIAL-XYZ')
        RETURNING id`, [DROP_ID]);

      // Parent row must have been inserted successfully.
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBeTruthy();

      // No event should have been emitted (serial not found → trigger returned early).
      const ev = await pool.query(`
        SELECT COUNT(*) FROM stock_serial_events
        WHERE source_table = 'qa_photo_reviews'
          AND source_id = $1`, [rows[0].id]);
      expect(Number(ev.rows[0].count)).toBe(0);
    } finally {
      await resetSeedSerial(pool);
      await clearEvents(pool);
      await pool.end();
    }
  });
});
