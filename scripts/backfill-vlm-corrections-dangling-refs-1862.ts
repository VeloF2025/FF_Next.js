#!/usr/bin/env tsx
/**
 * backfill-vlm-corrections-dangling-refs-1862.ts — Group D / D5-4 + D5-5 (#1862).
 *
 * Nulls the `source_id` of vlm_corrections whose `source_id` UUID points at a
 * row that no longer exists in the referenced table. `vlm_corrections` uses a
 * POLYMORPHIC reference (source_table + source_id), not a real FK, so deleting a
 * source row leaves the correction's source_id dangling — there is no cascade.
 * Nulling the dead id makes the dangling-reference queries return 0 while
 * keeping the correction itself (its harvested value is still useful; only the
 * link to the deleted origin row is gone).
 *
 *   D5-4: source_table='construction_qa_photos' → 12 dangling
 *   D5-5: source_table='eod_install_sheets'     → 11 dangling
 *
 * NOT touched here (deliberate):
 *   - source_table='gallery' (835): intentional VIRTUAL source linked by
 *     photo_url; source_id was always NULL by design — not dangling.
 *   - 115 unlinked wa_photos / 5 null-provenance rows: nothing to repair.
 *   - D5-1 stale vlm_extracted_value: informational (VLM is recon-only).
 *
 * SAFETY: DRY RUN BY DEFAULT. Pass --commit to write. Read + UPDATE run in ONE
 * transaction; a pre-update snapshot (id, source_table, dead source_id) is
 * written to /tmp for revert. Aborts (ROLLBACK + exit 1) if the UPDATE row count
 * does not match the plan. Idempotent: re-running finds nothing to null.
 *
 * Usage:
 *   npx tsx scripts/backfill-vlm-corrections-dangling-refs-1862.ts            # dry run
 *   npx tsx scripts/backfill-vlm-corrections-dangling-refs-1862.ts --commit   # LIVE
 *
 * DATABASE_URL must point at the target DB (shared Supabase). Controller-run,
 * after-hours only — touches production data.
 */
import { Pool } from 'pg';
import * as fs from 'node:fs';
import { log } from '@/lib/logger';

const COMMIT = process.argv.includes('--commit');

// (correction source_table → the table whose id its source_id should match).
const DANGLING_CHECKS: ReadonlyArray<{ sourceTable: string; refTable: string }> = [
  { sourceTable: 'construction_qa_photos', refTable: 'construction_qa_photos' },
  { sourceTable: 'eod_install_sheets', refTable: 'eod_install_sheets' },
];

interface DanglingRow {
  id: string;
  source_table: string;
  source_id: string;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('ERROR: DATABASE_URL not set\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    process.stdout.write(`\n=== Group D / D5-4+D5-5 — null dangling vlm_corrections.source_id ===\n`);
    process.stdout.write(`Mode:        ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN (default — no writes)'}\n`);

    await client.query('BEGIN');

    const dangling: DanglingRow[] = [];
    for (const { sourceTable, refTable } of DANGLING_CHECKS) {
      const { rows } = await client.query<DanglingRow>(
        `SELECT vc.id, vc.source_table, vc.source_id::text AS source_id
           FROM vlm_corrections vc
           LEFT JOIN ${refTable} r ON r.id = vc.source_id
          WHERE vc.source_table = $1
            AND vc.source_id IS NOT NULL
            AND r.id IS NULL`,
        [sourceTable],
      );
      process.stdout.write(`  ${sourceTable}: ${rows.length} dangling\n`);
      dangling.push(...rows);
    }

    process.stdout.write(`\nTotal dangling source_ids to null: ${dangling.length}\n`);
    if (dangling.length === 0) {
      await client.query('ROLLBACK');
      process.stdout.write(`Nothing to repair — clean.\n`);
      return;
    }

    for (const r of dangling.slice(0, 30)) {
      process.stdout.write(`  ${r.id}  source_table=${r.source_table}  dead source_id=${r.source_id}\n`);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = `/tmp/vlm-dangling-1862-snapshot-${stamp}.json`;
    fs.writeFileSync(snapshotPath, JSON.stringify(dangling, null, 2));
    process.stdout.write(`\nSnapshot (for revert): ${snapshotPath}\n`);

    if (!COMMIT) {
      await client.query('ROLLBACK');
      process.stdout.write(`\nDRY RUN complete. No rows changed. Re-run with --commit to apply.\n`);
      return;
    }

    const ids = dangling.map((r) => r.id);
    const res = await client.query(`UPDATE vlm_corrections SET source_id = NULL WHERE id = ANY($1::uuid[])`, [ids]);
    if (res.rowCount !== ids.length) {
      await client.query('ROLLBACK');
      process.stderr.write(
        `\nABORT: UPDATE affected ${res.rowCount} rows but ${ids.length} were planned — rolled back, no change.\n`,
      );
      process.exit(1);
    }
    await client.query('COMMIT');
    process.stdout.write(`\n=== Repair complete ===\nNulled source_id on ${res.rowCount} rows (matched plan of ${ids.length})\n`);
    process.stdout.write(`Snapshot for revert: ${snapshotPath}\n`);
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  log.error('backfill-vlm-corrections-dangling-refs-1862: unexpected error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
