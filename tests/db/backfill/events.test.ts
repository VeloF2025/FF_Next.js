import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillSerialEvents } from '../../../scripts/backfill-stock-serial-events';

const URL = process.env.DATABASE_URL_TEST!;

/**
 * Returns the serial UUID for ALCL12345002 (seed serial).
 * Deletes all stock_serial_events rows for it plus any test-inserted
 * pickings/returns rows.  Called at the START of each test's try block
 * AND in every finally — state leaks are Fatal per PR-3 quality review.
 */
async function resetSeedSerial(pool: Pool): Promise<void> {
  // Wipe event rows for the seed serial so idempotency checks start clean.
  await pool.query(`
    DELETE FROM stock_serial_events
    WHERE serial_id = '88888888-8888-8888-8888-888888888888'`);

  // Remove any test-inserted return lines + returns (seed has none).
  await pool.query(`
    DELETE FROM stock_return_lines
    WHERE stock_serial_id = '88888888-8888-8888-8888-888888888888'`);
  await pool.query(`
    DELETE FROM stock_returns
    WHERE id NOT IN (SELECT '00000000-0000-0000-0000-000000000000'::uuid)
      AND staff_id = '33333333-3333-3333-3333-333333333333'`);

  // Remove test-inserted pickings (preserve seed bbbb... row).
  await pool.query(`
    DELETE FROM stock_picking_lines spl
    USING stock_pickings sp
    WHERE spl.picking_id = sp.id
      AND sp.id <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND spl.stock_serial_id = '88888888-8888-8888-8888-888888888888'`);
  await pool.query(`
    DELETE FROM stock_pickings
    WHERE id <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND staff_id = '33333333-3333-3333-3333-333333333333'`);
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
        FROM stock_serial_events
        WHERE serial_id = '88888888-8888-8888-8888-888888888888'`);
      expect(ev.rows).toHaveLength(1);
      const row = ev.rows[0];
      expect(row.event_type).toBe('issued');
      expect(row.to_state).toBe('issued');
      expect(row.source_table).toBe('stock_pickings');
      expect(row.source_id).toBe('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
      expect(row.actor_staff_id).toBe('33333333-3333-3333-3333-333333333333');
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
      // Insert a planned picking for the same serial.
      const { rows: [{ id: plannedId }] } = await pool.query(`
        INSERT INTO stock_pickings (picking_type, status, staff_id)
        VALUES ('issue', 'planned', '33333333-3333-3333-3333-333333333333')
        RETURNING id`);
      await pool.query(`
        INSERT INTO stock_picking_lines (picking_id, stock_serial_id, serial_number)
        VALUES ($1, '88888888-8888-8888-8888-888888888888', 'ALCL12345002')`,
        [plannedId]);

      await backfillSerialEvents({ pool, source: 'pickings', commit: true });

      const ev = await pool.query(`
        SELECT source_id FROM stock_serial_events
        WHERE serial_id = '88888888-8888-8888-8888-888888888888'
          AND source_id = $1`, [plannedId]);
      // Event for the planned picking must NOT exist.
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
      // Seed has no returns; insert one.
      const { rows: [{ id: retId }] } = await pool.query(`
        INSERT INTO stock_returns (status, staff_id)
        VALUES ('pending_inspection', '33333333-3333-3333-3333-333333333333')
        RETURNING id`);
      await pool.query(`
        INSERT INTO stock_return_lines (return_id, stock_serial_id, serial_number)
        VALUES ($1, '88888888-8888-8888-8888-888888888888', 'ALCL12345002')`,
        [retId]);

      const r = await backfillSerialEvents({ pool, source: 'returns', commit: true });
      expect(r.inserted).toBeGreaterThanOrEqual(1);

      const ev = await pool.query(`
        SELECT event_type, to_state, source_table, source_id, payload, actor_staff_id
        FROM stock_serial_events
        WHERE serial_id = '88888888-8888-8888-8888-888888888888'`);
      expect(ev.rows).toHaveLength(1);
      const row = ev.rows[0];
      expect(row.event_type).toBe('returned');
      expect(row.to_state).toBe('returned');
      expect(row.source_table).toBe('stock_returns');
      expect(row.source_id).toBe(retId);
      expect(row.actor_staff_id).toBe('33333333-3333-3333-3333-333333333333');
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
      // Insert a return so both D and E have work to do.
      const { rows: [{ id: retId }] } = await pool.query(`
        INSERT INTO stock_returns (status, staff_id)
        VALUES ('pending_inspection', '33333333-3333-3333-3333-333333333333')
        RETURNING id`);
      await pool.query(`
        INSERT INTO stock_return_lines (return_id, stock_serial_id, serial_number)
        VALUES ($1, '88888888-8888-8888-8888-888888888888', 'ALCL12345002')`,
        [retId]);

      const r = await backfillSerialEvents({ pool, source: 'all', commit: true });
      // 1 picking event + 1 return event.
      expect(r.inserted).toBeGreaterThanOrEqual(2);

      const ev = await pool.query(`
        SELECT event_type FROM stock_serial_events
        WHERE serial_id = '88888888-8888-8888-8888-888888888888'
        ORDER BY event_type`);
      // Exactly 2 — guards against accidental duplicate inserts within a run.
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
      // Seed has 1 done picking; dry-run should report ≥1 wouldInsert.
      const r = await backfillSerialEvents({ pool, source: 'all', commit: false });
      expect(r.wouldInsert).toBeGreaterThanOrEqual(1);
      const ev = await pool.query(`
        SELECT COUNT(*) FROM stock_serial_events
        WHERE serial_id = '88888888-8888-8888-8888-888888888888'`);
      expect(Number(ev.rows[0].count)).toBe(0);
    } finally {
      await resetSeedSerial(pool);
      await pool.end();
    }
  });
});
