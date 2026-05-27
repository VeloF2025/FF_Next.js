#!/usr/bin/env tsx
/**
 * Backfill A: assets → stock_serials
 *
 * Prod schema correction (PR-7):
 *   - `assets` in prod does NOT have `asset_type` or `mac_address` columns.
 *     It contains fixed tools (EXFO OTDRs, splicers, etc.) tracked as company
 *     assets, never ONTs or Gizzus.
 *   - `stock_items` does NOT have a `device_type` column. ONT/Gizzu items are
 *     identified by `item_code` ('FT-ONT', 'FT-GIZZU') and
 *     `category = 'bootstock'`.
 *   - The caller now passes `itemCodes` (e.g. ['FT-ONT','FT-GIZZU']) instead
 *     of `deviceTypes`.
 *
 * The backfill joins `assets` via the `stock_item_id` FK that assets carries
 * (assets.stock_item_id → stock_items.id). Only assets whose linked stock_item
 * has one of the requested `itemCodes` are candidates. Because most assets are
 * tools without `stock_item_id`, the join naturally excludes them.
 *
 * `assets.serial_number` IS present in prod and is the serial to register.
 * `assets.mac_address` is NOT present; the MAC field is omitted in INSERT.
 */
import { Pool } from 'pg';
import { log } from '../src/lib/logger';
import { BackfillResult } from './backfill-types';

interface BackfillOptions {
  pool: Pool;
  /** stock_items.item_code values to register, e.g. ['FT-ONT','FT-GIZZU'] */
  itemCodes: string[];
  commit: boolean;
  limit?: number;
}

/**
 * Build a map from item_code → stock_item_id.
 * Throws if a given item_code maps to more than one stock_items row
 * (ambiguous; caller must resolve the duplication before running backfill).
 */
async function loadStockItemIds(pool: Pool, itemCodes: string[]) {
  const r = await pool.query(
    `SELECT id, item_code FROM stock_items WHERE item_code = ANY($1::text[])`,
    [itemCodes]);
  const byCode = new Map<string, string>();
  const seen = new Map<string, string[]>();
  for (const row of r.rows) {
    const arr = seen.get(row.item_code) ?? [];
    arr.push(row.id);
    seen.set(row.item_code, arr);
  }
  for (const [code, ids] of seen) {
    if (ids.length > 1) {
      log.error('backfill-assets: multiple stock_items share item_code — ambiguous mapping', {
        item_code: code, candidate_ids: ids,
      });
      throw new Error(
        `Ambiguous item_code "${code}" maps to ${ids.length} stock_items. ` +
        `Resolve the duplication before running backfill.`
      );
    }
    byCode.set(code, ids[0]);
  }
  return byCode;
}

export async function backfillAssetsToSerials(
  opts: BackfillOptions): Promise<BackfillResult> {
  const { pool, itemCodes, commit, limit } = opts;
  const stockItemIds = await loadStockItemIds(pool, itemCodes);
  if (stockItemIds.size === 0) {
    log.warn('backfill-assets: no stock_items match item codes', { itemCodes });
    return { inserted: 0, wouldInsert: 0, skipped: 0 };
  }

  const limitClause = limit ? `LIMIT ${Math.max(0, Math.floor(limit))}` : '';
  // Prod schema: assets.stock_item_id FK (nullable) links to stock_items.
  // Only assets that have stock_item_id pointing to an item in our allow-list
  // AND have a non-null serial_number are candidates.
  // mac_address is NOT a column on assets in prod — omitted.
  const select = `
    SELECT a.serial_number, a.created_at, si.item_code
    FROM assets a
    JOIN stock_items si ON si.id = a.stock_item_id
    WHERE si.item_code = ANY($1::text[])
      AND a.serial_number IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM stock_serials s
        WHERE s.serial_number = a.serial_number
          AND s.stock_item_id = a.stock_item_id
      )
    ${limitClause}`;

  const candidates = (await pool.query(select, [itemCodes])).rows;

  if (!commit) {
    return { inserted: 0, wouldInsert: candidates.length, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;
  for (const row of candidates) {
    const stockItemId = stockItemIds.get(row.item_code);
    if (!stockItemId) { skipped += 1; continue; }
    const r = await pool.query(
      `INSERT INTO stock_serials
         (stock_item_id, serial_number, status, created_at, updated_at)
       VALUES ($1, $2, 'available', $3, NOW())
       ON CONFLICT (stock_item_id, serial_number) DO NOTHING
       RETURNING id`,
      [stockItemId, row.serial_number, row.created_at]);
    if ((r.rowCount ?? 0) > 0) inserted += 1; else skipped += 1;
  }

  return { inserted, wouldInsert: 0, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) {
    process.stderr.write('--limit must be a positive integer\n');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write('DATABASE_URL not set\n'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillAssetsToSerials({
      pool, itemCodes: ['FT-ONT', 'FT-GIZZU'], commit, limit });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } finally {
    await pool.end();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) { main(); }
