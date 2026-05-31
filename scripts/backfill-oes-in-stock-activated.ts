#!/usr/bin/env tsx
/**
 * backfill-oes-in-stock-activated.ts — Group A one-time backfill (issue #1860).
 *
 * Heals the historical serials that are 'Active' in OES (with activation_date +
 * drop_number) but stuck in stock_serials.status='in_stock' (or 'installed')
 * because the OES activation cascade never advanced them. The forward fix
 * (PR #1865) only handles serials whose oes_pp_data row was JUST flipped to
 * 'activated'; these historical rows are already 'activated' in oes_pp_data, so
 * triggerPpActivationCheck never re-selects them — they need this backfill.
 *
 * Promotes each via the SANCTIONED promoteSerial() path (NOT a direct UPDATE):
 *   - in_stock  → activated   (mig 393, event_type 'activated_on_oes')
 *   - installed → activated   (mig 387, event_type 'activated')
 * The mig 387 validate trigger gates the transition; the emit trigger writes
 * the event. Per-serial transaction (Pool path) → one bad serial never blocks
 * the rest. Idempotent: the selection excludes already-'activated' serials and
 * the stock_serial_events dedup index (serial_id, source_table, source_id,
 * event_type) prevents duplicate events on re-run.
 *
 * SAFETY: DRY RUN BY DEFAULT. Pass --commit to mutate. A pre-commit snapshot of
 * every affected (id, prior_status, serial_number, drop_number) is written to a
 * JSON file for manual revert reference before any write happens.
 *
 * Usage:
 *   npx tsx scripts/backfill-oes-in-stock-activated.ts                 # dry run
 *   npx tsx scripts/backfill-oes-in-stock-activated.ts --limit 50      # dry run, 50 rows
 *   npx tsx scripts/backfill-oes-in-stock-activated.ts --commit        # LIVE
 *   npx tsx scripts/backfill-oes-in-stock-activated.ts --commit --batch 500
 *
 * DATABASE_URL must point at the target DB (shared Supabase). Controller-run,
 * after-hours only — touches production data.
 */
import { Pool } from 'pg';
import * as fs from 'node:fs';
import { log } from '@/lib/logger';
import { promoteSerial, type SerialStatus } from '@/modules/procurement/field-stock/services/serialLifecycle';

const COMMIT = process.argv.includes('--commit');
const limitArg = process.argv.find((_, i, arr) => arr[i - 1] === '--limit');
const batchArg = process.argv.find((_, i, arr) => arr[i - 1] === '--batch');
const LIMIT = limitArg ? parseInt(limitArg, 10) : null;
const BATCH = batchArg ? parseInt(batchArg, 10) : 500;

// Guard mistyped flag values (e.g. `--batch --commit` → parseInt('--commit') = NaN)
// before any DB work, so progress logging works and a NaN limit can't surprise.
if (LIMIT !== null && (Number.isNaN(LIMIT) || LIMIT <= 0)) {
  process.stderr.write('ERROR: --limit requires a positive integer\n');
  process.exit(1);
}
if (Number.isNaN(BATCH) || BATCH <= 0) {
  process.stderr.write('ERROR: --batch requires a positive integer\n');
  process.exit(1);
}

interface StuckSerial {
  id: string;
  serial_number: string;
  status: string;
  drop_number: string;
  activation_date: string;
}

const SELECT_STUCK = `
  SELECT DISTINCT ON (ss.id)
         ss.id,
         ss.serial_number,
         ss.status,
         oa.drop_number,
         oa.activation_date::text AS activation_date
  FROM oes_activations oa
  JOIN stock_serials ss ON ss.serial_number = oa.serial_number
  WHERE oa.status = 'Active'
    AND oa.activation_date IS NOT NULL
    AND oa.drop_number IS NOT NULL
    AND ss.status IN ('in_stock', 'installed')
  ORDER BY ss.id, oa.activation_date DESC
`;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('ERROR: DATABASE_URL not set\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });

  try {
    const sql = LIMIT ? `${SELECT_STUCK} LIMIT ${LIMIT}` : SELECT_STUCK;
    const { rows } = await pool.query<StuckSerial>(sql);

    const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    process.stdout.write(`\n=== Group A backfill — OES-active serials stuck pre-activated ===\n`);
    process.stdout.write(`Mode:        ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN (default — no writes)'}\n`);
    process.stdout.write(`Candidates:  ${rows.length}${LIMIT ? ` (capped by --limit ${LIMIT})` : ''}\n`);
    process.stdout.write(`By status:   ${JSON.stringify(byStatus)}\n`);
    process.stdout.write(`Batch size:  ${BATCH}\n`);
    if (rows.length > 0) {
      process.stdout.write(`Sample (first 10):\n`);
      for (const r of rows.slice(0, 10)) {
        process.stdout.write(`  ${r.serial_number}  ${r.status} -> activated  drop=${r.drop_number}  oes=${r.activation_date}\n`);
      }
    }

    if (rows.length === 0) {
      process.stdout.write(`\nNothing to backfill — clean.\n`);
      return;
    }

    // Pre-commit snapshot for revert reference (written in BOTH modes).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = `/tmp/oes-backfill-snapshot-${stamp}.json`;
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        rows.map((r) => ({ id: r.id, prior_status: r.status, serial_number: r.serial_number, drop_number: r.drop_number, activation_date: r.activation_date })),
        null,
        2,
      ),
    );
    process.stdout.write(`\nSnapshot of affected rows written: ${snapshotPath}\n`);

    if (!COMMIT) {
      process.stdout.write(`\nDRY RUN complete. No rows changed. Re-run with --commit to apply.\n`);
      return;
    }

    process.stdout.write(`\nPromoting ${rows.length} serials via promoteSerial()...\n`);
    let promoted = 0;
    let failed = 0;
    const failures: Array<{ serial: string; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        await promoteSerial(pool, {
          serialId:    r.id,
          toStatus:    'activated' as SerialStatus,
          sourceTable: 'oes_activations',
          sourceId:    r.id, // each serial activates once; dedup index makes re-runs no-ops
          payload: {
            serial_number:   r.serial_number,
            drop_number:     r.drop_number,
            activation_date: r.activation_date,
            activated_via:   'backfill_oes_in_stock_393',
          },
        });
        promoted++;
      } catch (err: unknown) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        failures.push({ serial: r.serial_number, error: message });
        log.warn('backfill: serial promotion failed (non-blocking)', {
          serial_number: r.serial_number, prior_status: r.status, error: message,
        });
      }
      if ((i + 1) % BATCH === 0) {
        process.stdout.write(`  ...${i + 1}/${rows.length} processed (promoted=${promoted}, failed=${failed})\n`);
      }
    }

    process.stdout.write(`\n=== Backfill complete ===\n`);
    process.stdout.write(`Promoted: ${promoted}  Failed: ${failed}  Total: ${rows.length}\n`);
    if (failures.length > 0) {
      process.stdout.write(`First failures:\n`);
      for (const f of failures.slice(0, 10)) {
        process.stdout.write(`  ${f.serial}: ${f.error}\n`);
      }
    }
    process.stdout.write(`Snapshot for revert: ${snapshotPath}\n`);
    process.stdout.write(`Verify: re-run the D1-1 query (should drop by ~${promoted}).\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  log.error('backfill-oes-in-stock-activated: unexpected error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
