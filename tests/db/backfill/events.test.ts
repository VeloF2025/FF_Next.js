import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillSerialEvents } from '../../../scripts/backfill-stock-serial-events';

const URL = process.env.DATABASE_URL_TEST!;

const SEED_SERIAL_ID = '88888888-8888-8888-8888-888888888888';
const SEED_PICK_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TECH_ID        = '33333333-3333-3333-3333-333333333333';
const STOCK_ITEM_ID  = '55555555-5555-5555-5555-555555555555';
const SOURCE_LOC     = '10000000-0000-0000-0000-000000000001';
const DEST_LOC       = '10000000-0000-0000-0000-000000000002';

/**
 * Reset state for seed serial 88888888 (ALCL12345002). Deletes events plus any
 * test-inserted pickings/returns rows. Called at the START of each test's try
 * block AND in every finally — state leaks are Fatal per PR-3 quality review.
 */
async function resetSeedSerial(pool: Pool): Promise<void> {
  await pool.query(`
    DELETE FROM stock_serial_events WHERE serial_id = $1`, [SEED_SERIAL_ID]);

  // Remove test-inserted return lines + returns (seed has none).
  await pool.query(`
    DELETE FROM stock_return_lines WHERE serial_id = $1`, [SEED_SERIAL_ID]);
  await pool.query(`
    DELETE FROM stock_returns
    WHERE  id NOT IN (SELECT '00000000-0000-0000-0000-000000000000'::uuid)
      AND  returned_by_id = $1`, [TECH_ID]);

  // Remove test-inserted pickings (preserve the seed bbbb picking).
  await pool.query(`
    DELETE FROM stock_picking_lines spl
    USING  stock_pickings sp
    WHERE  spl.picking_id = sp.id
      AND  sp.id <> $1
      AND  $2::uuid = ANY(spl.serial_ids)`, [SEED_PICK_ID, SEED_SERIAL_ID]);
  await pool.query(`
    DELETE FROM stock_pickings
    WHERE  id <> $1 AND technician_id = $2`, [SEED_PICK_ID, TECH_ID]);
}

describe('Backfill D: stock_pickings → issued events', () => {
  it('inserts an issued event for a done picking with correct fields', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      const r = await backfillSerialEvents({ pool, source: 'pickings', commit: true });
      expect(r.inserted).toBeGreaterThanOrEqual(1);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id, payload, actor_staff_id
        FROM   stock_serial_events
        WHERE  serial_id = $1`, [SEED_SERIAL_ID]);
      expect(ev.rows).toHaveLength(1);
      const row = ev.rows[0];
      expect(row.event_type).toBe('issued');
      expect(row.to_state).toBe('issued');
      expect(row.source_table).toBe('stock_pickings');
      expect(row.source_id).toBe(SEED_PICK_ID);
      expect(row.actor_staff_id).toBe(TECH_ID);
      expect(row.payload?.backfilled).toBe(true);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('does not emit an event for a non-done picking', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // Insert a planned picking for the same serial — prod schema requires
      // picking_number, picking_type, source_location_id, destination_location_id.
      const { rows: [{ id: plannedId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_pickings
          (picking_number, picking_type, status,
           source_location_id, destination_location_id, technician_id)
        VALUES ('PICK-TEST-PLAN-' || substr(md5(random()::text), 1, 10),
                'issue', 'planned', $1, $2, $3)
        RETURNING id`, [SOURCE_LOC, DEST_LOC, TECH_ID]);
      await pool.query(`
        INSERT INTO stock_picking_lines
          (picking_id, stock_item_id, serial_ids, serial_number)
        VALUES ($1, $2, ARRAY[$3::uuid], 'ALCL12345002')`,
        [plannedId, STOCK_ITEM_ID, SEED_SERIAL_ID]);

      await backfillSerialEvents({ pool, source: 'pickings', commit: true });

      const ev = await pool.query(`
        SELECT source_id FROM stock_serial_events
        WHERE serial_id = $1 AND source_id = $2`, [SEED_SERIAL_ID, plannedId]);
      expect(ev.rows).toHaveLength(0);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });
});

describe('Backfill E: stock_returns → returned events', () => {
  it('inserts a returned event for a return row', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      // Seed has no returns; insert one. Prod schema requires return_number.
      const { rows: [{ id: retId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_returns
          (return_number, status, returned_by_id, return_date)
        VALUES ('RET-TEST-' || substr(md5(random()::text), 1, 10),
                'pending', $1, NOW())
        RETURNING id`, [TECH_ID]);
      await pool.query(`
        INSERT INTO stock_return_lines
          (return_id, stock_item_id, serial_id, serial_number)
        VALUES ($1, $2, $3, 'ALCL12345002')`,
        [retId, STOCK_ITEM_ID, SEED_SERIAL_ID]);

      // PR-6 triggers fire on INSERT into stock_return_lines and emit a
      // 'returned' event immediately. Delete trigger-created events so the
      // backfill script has its own fresh work (testing backfill E in isolation).
      await pool.query(`
        DELETE FROM stock_serial_events WHERE serial_id = $1`, [SEED_SERIAL_ID]);

      const r = await backfillSerialEvents({ pool, source: 'returns', commit: true });
      expect(r.inserted).toBeGreaterThanOrEqual(1);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id, payload, actor_staff_id
        FROM   stock_serial_events
        WHERE  serial_id = $1`, [SEED_SERIAL_ID]);
      expect(ev.rows).toHaveLength(1);
      const row = ev.rows[0];
      expect(row.event_type).toBe('returned');
      expect(row.to_state).toBe('returned');
      expect(row.source_table).toBe('stock_returns');
      expect(row.source_id).toBe(retId);
      expect(row.actor_staff_id).toBe(TECH_ID);
      expect(row.payload?.backfilled).toBe(true);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });
});

describe('Backfill D+E: source=all', () => {
  it('source=all runs both pickings and returns backfills', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      const { rows: [{ id: retId }] } = await pool.query<{ id: string }>(`
        INSERT INTO stock_returns
          (return_number, status, returned_by_id, return_date)
        VALUES ('RET-TEST-' || substr(md5(random()::text), 1, 10),
                'pending', $1, NOW())
        RETURNING id`, [TECH_ID]);
      await pool.query(`
        INSERT INTO stock_return_lines
          (return_id, stock_item_id, serial_id, serial_number)
        VALUES ($1, $2, $3, 'ALCL12345002')`,
        [retId, STOCK_ITEM_ID, SEED_SERIAL_ID]);

      // Wipe trigger-created event so both D + E have fresh work to do.
      await pool.query(`
        DELETE FROM stock_serial_events WHERE serial_id = $1`, [SEED_SERIAL_ID]);

      const r = await backfillSerialEvents({ pool, source: 'all', commit: true });
      expect(r.inserted).toBeGreaterThanOrEqual(2);

      const ev = await pool.query(`
        SELECT event_type FROM stock_serial_events
        WHERE  serial_id = $1
        ORDER  BY event_type`, [SEED_SERIAL_ID]);
      expect(ev.rows).toHaveLength(2);
      const types = ev.rows.map((x: { event_type: string }) => x.event_type);
      expect(types).toContain('issued');
      expect(types).toContain('returned');
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('idempotent — second run inserts 0', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      await backfillSerialEvents({ pool, source: 'all', commit: true });
      const second = await backfillSerialEvents({ pool, source: 'all', commit: true });
      expect(second.inserted).toBe(0);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });

  it('dry-run reports wouldInsert without mutating', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await resetSeedSerial(pool);
      const r = await backfillSerialEvents({ pool, source: 'all', commit: false });
      expect(r.wouldInsert).toBeGreaterThanOrEqual(1);
      const ev = await pool.query(`
        SELECT COUNT(*) FROM stock_serial_events WHERE serial_id = $1`, [SEED_SERIAL_ID]);
      expect(Number(ev.rows[0].count)).toBe(0);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });
});
