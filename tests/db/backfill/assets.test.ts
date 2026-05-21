import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillAssetsToSerials } from '../../../scripts/backfill-stock-serials-from-assets';

const URL = process.env.DATABASE_URL_TEST!;

async function reseedAsset(pool: Pool, serial: string, type: string) {
  await pool.query(
    `INSERT INTO assets (asset_type, serial_number) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`, [type, serial]);
}

describe('Backfill A: assets → stock_serials', () => {
  it('inserts a new stock_serials row for an ONT asset not yet registered', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      // seed.sql provides asset ALCL12345003 with no stock_serials row.
      const result = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont', 'gizzu'], commit: true });
      expect(result.inserted).toBeGreaterThanOrEqual(1);
      const r = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number = 'ALCL12345003'`);
      expect(r.rows[0]?.status).toBe('available');
    } finally { await pool.end(); }
  });

  it('is idempotent — second run inserts zero rows', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillAssetsToSerials({ pool, deviceTypes: ['ont','gizzu'], commit: true });
      const second = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont','gizzu'], commit: true });
      expect(second.inserted).toBe(0);
    } finally { await pool.end(); }
  });

  it('--dry-run inserts nothing', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await reseedAsset(pool, 'ALCL12345099', 'ont');
      const result = await backfillAssetsToSerials({
        pool, deviceTypes: ['ont','gizzu'], commit: false });
      expect(result.wouldInsert).toBeGreaterThanOrEqual(1);
      const r = await pool.query(
        `SELECT COUNT(*) FROM stock_serials WHERE serial_number = 'ALCL12345099'`);
      expect(Number(r.rows[0].count)).toBe(0);
    } finally { await pool.end(); }
  });

  it('skips device types not in the allow-list', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await pool.query(`INSERT INTO assets (asset_type, serial_number)
                        VALUES ('splitter', 'SPL0000001')`);
      await backfillAssetsToSerials({
        pool, deviceTypes: ['ont','gizzu'], commit: true });
      const r = await pool.query(
        `SELECT COUNT(*) FROM stock_serials WHERE serial_number = 'SPL0000001'`);
      expect(Number(r.rows[0].count)).toBe(0);
    } finally {
      await pool.query(`DELETE FROM assets WHERE serial_number = 'SPL0000001'`);
      await pool.end();
    }
  });
});
