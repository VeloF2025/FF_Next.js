#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';
import type { BackfillResult } from './backfill-types';

interface Opts { pool: Pool; commit: boolean; }

/**
 * For each qa_photo_reviews row, find the matching stock_serials row by
 * serial_number. If status is one of the "pre-install" set and
 * installed_at_drop_id IS NULL, set installed_at_drop_id = qa.drop_id and
 * status='installed'. Never downgrade from activated/faulty/scrapped.
 *
 * "latest per serial" is enforced via DISTINCT ON (ont_serial)
 * ORDER BY created_at DESC.
 */
export async function backfillInstallsFromQA(opts: Opts): Promise<BackfillResult> {
  const { pool, commit } = opts;
  const select = `
    SELECT DISTINCT ON (qa.ont_serial)
      qa.ont_serial AS serial_number,
      qa.drop_id,
      qa.created_at
    FROM qa_photo_reviews qa
    WHERE qa.ont_serial IS NOT NULL
      AND qa.drop_id   IS NOT NULL
    ORDER BY qa.ont_serial, qa.created_at DESC`;

  const candidates = (await pool.query(select)).rows;

  if (!commit) {
    const c = await pool.query(
      `WITH cand AS (${select})
       SELECT COUNT(*) FROM cand c
       JOIN stock_serials s ON s.serial_number = c.serial_number
       WHERE s.installed_at_drop_id IS NULL
         AND s.status IN ('available','reserved','issued',
                          'allocated_to_project','in_transit')`);
    return { updated: 0, wouldUpdate: Number(c.rows[0].count), skipped: 0 };
  }

  let updated = 0, skipped = 0;
  for (const row of candidates) {
    const r = await pool.query(
      `UPDATE stock_serials
         SET installed_at_drop_id = $1,
             status = 'installed',
             updated_at = NOW()
       WHERE serial_number = $2
         AND installed_at_drop_id IS NULL
         AND status IN ('available','reserved','issued',
                        'allocated_to_project','in_transit')
       RETURNING id`,
      [row.drop_id, row.serial_number]);
    if ((r.rowCount ?? 0) > 0) updated += 1; else skipped += 1;
  }
  log.info('backfill-installs done', { updated, skipped });
  return { updated, wouldUpdate: 0, skipped };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillInstallsFromQA({ pool, commit });
    console.log(JSON.stringify(r, null, 2));
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
