import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';
import { backfillAssetsToSerials } from '../../../scripts/backfill-stock-serials-from-assets';

const URL = process.env.DATABASE_URL_TEST!;

/**
 * Seed an extra asset linked to FT-ONT stock_item (for dry-run / extra-serial tests).
 * Prod schema: assets has name, category_id, serial_number, stock_item_id.
 * The stock_item_id FK must point to the FT-ONT row seeded in stock_items.
 */
async function reseedAsset(pool: Pool, serial: string, itemCode: string) {
  // Look up the stock_item_id for the given item_code
  const si = await pool.query(
    `SELECT id FROM stock_items WHERE item_code = $1`, [itemCode]);
  const stockItemId: string | undefined = si.rows[0]?.id;

  // Look up or use a placeholder category_id
  const cat = await pool.query(
    `SELECT id FROM asset_categories LIMIT 1`);
  const catId: string | undefined = cat.rows[0]?.id;

  if (!stockItemId || !catId) return;

  await pool.query(
    `INSERT INTO assets (asset_number, name, category_id, serial_number, stock_item_id)
     VALUES ('', $1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [`Asset-${serial}`, catId, serial, stockItemId]);
}

describe('Backfill A: assets → stock_serials', () => {
  it('inserts a new stock_serials row for an ONT asset not yet registered', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      // seed.sql provides asset ALCL12345003 linked to FT-ONT, no stock_serials row yet.
      const result = await backfillAssetsToSerials({
        pool, itemCodes: ['FT-ONT', 'FT-GIZZU'], commit: true });
      expect(result.inserted).toBeGreaterThanOrEqual(1);
      const r = await pool.query(
        `SELECT status FROM stock_serials WHERE serial_number = 'ALCL12345003'`);
      expect(r.rows[0]?.status).toBe('available');
    } finally { await pool.end(); }
  });

  it('is idempotent — second run inserts zero rows', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await backfillAssetsToSerials({ pool, itemCodes: ['FT-ONT','FT-GIZZU'], commit: true });
      const second = await backfillAssetsToSerials({
        pool, itemCodes: ['FT-ONT','FT-GIZZU'], commit: true });
      expect(second.inserted).toBe(0);
    } finally { await pool.end(); }
  });

  it('--dry-run inserts nothing', async () => {
    const pool = new Pool({ connectionString: URL });
    try {
      await reseedAsset(pool, 'ALCL12345099', 'FT-ONT');
      const result = await backfillAssetsToSerials({
        pool, itemCodes: ['FT-ONT','FT-GIZZU'], commit: false });
      expect(result.wouldInsert).toBeGreaterThanOrEqual(1);
      const r = await pool.query(
        `SELECT COUNT(*) FROM stock_serials WHERE serial_number = 'ALCL12345099'`);
      expect(Number(r.rows[0].count)).toBe(0);
    } finally { await pool.end(); }
  });

  it('skips assets whose stock_item is not in the allow-list', async () => {
    const pool = new Pool({ connectionString: URL });
    // Insert a stock_item not in the allow-list
    await pool.query(`INSERT INTO stock_items (item_code, name, category, tracking_type)
                      VALUES ('TOOL-SPLITTER', 'Optical Splitter', 'optics', 'serial')
                      ON CONFLICT DO NOTHING`);
    try {
      const catId = (await pool.query(`SELECT id FROM asset_categories LIMIT 1`)).rows[0]?.id;
      const siId  = (await pool.query(`SELECT id FROM stock_items WHERE item_code='TOOL-SPLITTER'`)).rows[0]?.id;
      await pool.query(
        `INSERT INTO assets (asset_number, name, category_id, serial_number, stock_item_id)
         VALUES ('', 'Splitter-SPL0000001', $1, 'SPL0000001', $2)`,
        [catId, siId]);
      await backfillAssetsToSerials({
        pool, itemCodes: ['FT-ONT','FT-GIZZU'], commit: true });
      const r = await pool.query(
        `SELECT COUNT(*) FROM stock_serials WHERE serial_number = 'SPL0000001'`);
      expect(Number(r.rows[0].count)).toBe(0);
    } finally {
      await pool.query(`DELETE FROM assets WHERE serial_number = 'SPL0000001'`);
      await pool.end();
    }
  });
});
