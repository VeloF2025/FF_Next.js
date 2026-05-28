import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool, PoolClient } from 'pg';
import { withSerialEventContext, SERIAL_EVENT_GUCS } from '@/lib/db/serialEventContext';

describe('serialEventContext', () => {
  let pool: Pool;
  beforeAll(() => { pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); });
  afterAll(async () => { await pool.end(); });

  it('sets GUCs visible inside the txn and clears on exit', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const sourceTable = 'stock_pickings';
      const sourceId = '11111111-1111-1111-1111-111111111111';
      const inner = await withSerialEventContext(
        client,
        { sourceTable, sourceId, payload: { drop_number: 'DR1' } },
        async () => {
          const r = await client.query(`SELECT current_setting('ff.event_source_table', true) as t, current_setting('ff.event_source_id', true) as i, current_setting('ff.event_payload', true) as p`);
          return r.rows[0];
        }
      );
      expect(inner.t).toBe(sourceTable);
      expect(inner.i).toBe(sourceId);
      expect(JSON.parse(inner.p)).toEqual({ drop_number: 'DR1' });
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
