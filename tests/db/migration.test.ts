import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

const URL = process.env.DATABASE_URL_TEST!;

describe('Wave 1 migration', () => {
  it('extends stock_serials.status CHECK with the 3 new states', async () => {
    const pool = new Pool({ connectionString: URL });
    const r = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conname = 'stock_serials_status_check'`);
    await pool.end();
    expect(r.rows[0].def).toMatch(/activated/);
    expect(r.rows[0].def).toMatch(/in_repair/);
    expect(r.rows[0].def).toMatch(/allocated_to_project/);
  });

  it('adds allocated_to_project_id and activated_at_olt_id columns', async () => {
    const pool = new Pool({ connectionString: URL });
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'stock_serials'
      AND column_name IN ('allocated_to_project_id', 'activated_at_olt_id')`);
    await pool.end();
    expect(r.rows.map(x => x.column_name).sort()).toEqual(
      ['activated_at_olt_id', 'allocated_to_project_id']);
  });

  it('creates stock_serial_events with the required indexes', async () => {
    const pool = new Pool({ connectionString: URL });
    const r = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'stock_serial_events'`);
    await pool.end();
    const names = r.rows.map(x => x.indexname);
    expect(names).toContain('idx_sse_serial_time');
    expect(names).toContain('idx_sse_event_type');
    expect(names).toContain('idx_sse_source');
  });
});
