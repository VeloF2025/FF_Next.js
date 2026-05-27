#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';
import type { BackfillResult } from './backfill-types';

interface Opts { pool: Pool; commit: boolean; }

/**
 * For each qa_photo_reviews row, find the matching stock_serials row by
 * serial_number. If status is one of the "pre-install" set and
 * installed_at_drop_id IS NULL, set installed_at_drop_id from drops.id
 * (looked up via drop_number) and status='installed'.
 * Never downgrade from activated/faulty/scrapped.
 *
 * Prod schema corrections (PR-7):
 *   - qa_photo_reviews.ont_serial does NOT exist; prod column is
 *     `ont_serial_scanned`.
 *   - qa_photo_reviews.drop_id does NOT exist; prod has `drop_number`
 *     (text). Join drops on drop_number to obtain the UUID.
 *
 * "latest per serial" is enforced via DISTINCT ON (ont_serial_scanned)
 * ORDER BY created_at DESC.
 */
export async function backfillInstallsFromQA(opts: Opts): Promise<BackfillResult> {
  const { pool, commit } = opts;
  const select = `
    SELECT DISTINCT ON (qa.ont_serial_scanned)
      qa.ont_serial_scanned AS serial_number,
      d.id                  AS drop_id,
      qa.created_at
    FROM qa_photo_reviews qa
    JOIN drops d ON d.drop_number = qa.drop_number
    WHERE qa.ont_serial_scanned IS NOT NULL
      AND qa.drop_number         IS NOT NULL
    ORDER BY qa.ont_serial_scanned, qa.created_at DESC`;

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
  if (!url) { process.stderr.write('DATABASE_URL not set\n'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillInstallsFromQA({ pool, commit });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } finally { await pool.end(); }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
