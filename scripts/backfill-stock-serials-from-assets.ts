#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';

interface BackfillOptions {
  pool: Pool;
  deviceTypes: string[];
  commit: boolean;
  limit?: number;
}

export interface BackfillResult {
  inserted: number;
  wouldInsert: number;
  skipped: number;
}

async function loadStockItemIds(pool: Pool, deviceTypes: string[]) {
  const r = await pool.query(
    `SELECT id, device_type FROM stock_items WHERE device_type = ANY($1::text[])`,
    [deviceTypes]);
  const byType = new Map<string, string>();
  for (const row of r.rows) {
    if (!byType.has(row.device_type)) byType.set(row.device_type, row.id);
  }
  return byType;
}

export async function backfillAssetsToSerials(
  opts: BackfillOptions): Promise<BackfillResult> {
  const { pool, deviceTypes, commit, limit } = opts;
  const stockItemIds = await loadStockItemIds(pool, deviceTypes);
  if (stockItemIds.size === 0) {
    log.warn('backfill-assets: no stock_items match device types', { deviceTypes });
    return { inserted: 0, wouldInsert: 0, skipped: 0 };
  }

  const limitClause = limit ? `LIMIT ${Math.max(0, Math.floor(limit))}` : '';
  const select = `
    SELECT a.serial_number, a.mac_address, a.asset_type, a.created_at
    FROM assets a
    WHERE a.asset_type = ANY($1::text[])
      AND NOT EXISTS (
        SELECT 1 FROM stock_serials s
        WHERE s.serial_number = a.serial_number
          AND s.stock_item_id IN (
            SELECT id FROM stock_items WHERE device_type = a.asset_type)
      )
    ${limitClause}`;

  const candidates = (await pool.query(select, [deviceTypes])).rows;

  if (!commit) {
    return { inserted: 0, wouldInsert: candidates.length, skipped: 0 };
  }

  let inserted = 0;
  let skipped = 0;
  for (const row of candidates) {
    const stockItemId = stockItemIds.get(row.asset_type);
    if (!stockItemId) { skipped += 1; continue; }
    const r = await pool.query(
      `INSERT INTO stock_serials
         (stock_item_id, serial_number, mac_address, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'available', $4, NOW())
       ON CONFLICT (stock_item_id, serial_number) DO NOTHING
       RETURNING id`,
      [stockItemId, row.serial_number, row.mac_address, row.created_at]);
    if ((r.rowCount ?? 0) > 0) inserted += 1; else skipped += 1;
  }

  return { inserted, wouldInsert: 0, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillAssetsToSerials({
      pool, deviceTypes: ['ont', 'gizzu'], commit, limit });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await pool.end();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) { main(); }
