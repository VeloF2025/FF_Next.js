#!/usr/bin/env tsx
/**
 * backfill-ppoes-overlap-sync-1861.ts — Group C / PP/OES overlap sync (#1861).
 *
 * One-time heal of the historical PP/OES sync gaps the post-import back-propagation
 * never applied. Mirrors the forward fix in oesPostImportService.triggerPpActivationCheck.
 *
 * Steps (all in ONE transaction):
 *   D4-1  Promote located_* PP rows whose resolved_drop_number is in oes_activations
 *         to 'activated', SKIPPING serial conflicts (PP serial differs from OES serial
 *         for that drop). ~248.
 *   D4-4  Fill activated_at (from OES activation_datetime/activation_date) on
 *         resolution_status='activated', resolved_source='oes_activations' rows that
 *         are still NULL. ~64.
 *   D4-5  Back-propagate drops.oes_confirmed=true for every drop now 'activated' in
 *         oes_pp_data but flagged false/NULL. ~53.
 *
 * FLAGGED, NOT FIXED (reported only — business decision, see issue #1861):
 *   D1-5  PP-vs-OES drop_number conflicts for the same serial (~172).
 *   D4-3  'activated' PP rows whose drop is absent from oes_activations (~57;
 *         non-OES-sourced activation claims).
 *
 * SAFETY: DRY RUN BY DEFAULT (mutations run then ROLLBACK so counts are exact).
 * Pass --commit to persist. Pre-change snapshot written to /tmp for revert.
 *
 * Usage:
 *   npx tsx scripts/backfill-ppoes-overlap-sync-1861.ts            # dry run
 *   npx tsx scripts/backfill-ppoes-overlap-sync-1861.ts --commit   # LIVE
 *
 * DATABASE_URL must point at the target DB (shared Supabase). Controller-run,
 * after-hours only — touches production data.
 */
import { Pool } from 'pg';
import * as fs from 'node:fs';
import { log } from '@/lib/logger';

const COMMIT = process.argv.includes('--commit');

// DISTINCT ON one activation per drop (latest), shared by the promote + fill steps.
const OA1 = `
  oa1 AS (
    SELECT DISTINCT ON (drop_number)
           drop_number, serial_number, activation_date, activation_datetime, status
    FROM oes_activations
    ORDER BY drop_number, activation_datetime DESC NULLS LAST
  )
`;

// D4-1: promote located_* → activated, skipping serial conflicts.
const SQL_D4_1 = `
  WITH ${OA1}
  UPDATE oes_pp_data pp
  SET resolution_status = 'activated',
      resolved_source = COALESCE(pp.resolved_source, 'oes_activations'),
      resolved_details = COALESCE(pp.resolved_details, '{}'::jsonb) || jsonb_build_object(
        'activated_date', oa1.activation_date::text,
        'activated_status', oa1.status,
        'promoted_from', pp.resolution_status,
        'promoted_by', 'backfill_1861'
      ),
      activated_at = COALESCE(pp.activated_at, oa1.activation_datetime, oa1.activation_date::timestamptz),
      resolved_at = COALESCE(pp.resolved_at, NOW()),
      updated_at = NOW()
  FROM oa1
  WHERE oa1.drop_number = pp.resolved_drop_number
    AND pp.resolution_status IN ('located_1map', 'located_local', 'located_unified')
    AND NOT (
      pp.serial_number IS NOT NULL AND TRIM(pp.serial_number) NOT IN ('', '-')
      AND oa1.serial_number IS NOT NULL AND TRIM(oa1.serial_number) NOT IN ('', '-')
      AND UPPER(TRIM(pp.serial_number)) <> UPPER(TRIM(oa1.serial_number))
    )
  RETURNING pp.id, pp.resolved_drop_number AS drop_number, pp.serial_number
`;

// D4-4: fill activated_at on already-activated oes-sourced rows still NULL.
const SQL_D4_4 = `
  WITH ${OA1}
  UPDATE oes_pp_data pp
  SET activated_at = COALESCE(oa1.activation_datetime, oa1.activation_date::timestamptz),
      updated_at = NOW()
  FROM oa1
  WHERE oa1.drop_number = pp.resolved_drop_number
    AND pp.resolution_status = 'activated'
    AND pp.resolved_source = 'oes_activations'
    AND pp.activated_at IS NULL
    AND COALESCE(oa1.activation_datetime, oa1.activation_date::timestamptz) IS NOT NULL
  RETURNING pp.id, pp.resolved_drop_number AS drop_number
`;

// D4-5: back-propagate drops.oes_confirmed for all activated PP drops.
const SQL_D4_5 = `
  UPDATE drops d
  SET oes_confirmed = true,
      oes_confirmed_at = COALESCE(d.oes_confirmed_at, NOW())
  FROM (
    SELECT DISTINCT resolved_drop_number AS drop_number
    FROM oes_pp_data
    WHERE resolution_status = 'activated' AND resolved_drop_number IS NOT NULL
  ) act
  WHERE act.drop_number = d.drop_number
    AND (d.oes_confirmed = false OR d.oes_confirmed IS NULL)
  RETURNING d.id, d.drop_number
`;

// Flag-only (read): counts surfaced for the activations owner, never auto-changed.
const SQL_FLAG_D1_5 = `
  SELECT COUNT(*) AS n FROM oes_pp_data opd
  INNER JOIN oes_activations oa ON oa.serial_number = opd.serial_number
  WHERE oa.status = 'Active' AND opd.resolution_status = 'activated'
    AND opd.resolved_drop_number IS NOT NULL AND oa.drop_number IS NOT NULL
    AND UPPER(TRIM(opd.resolved_drop_number)) <> UPPER(TRIM(oa.drop_number))
`;
const SQL_FLAG_D4_3 = `
  SELECT COUNT(*) AS n FROM oes_pp_data opd
  WHERE opd.resolution_status = 'activated' AND opd.resolved_drop_number IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM oes_activations oa WHERE oa.drop_number = opd.resolved_drop_number)
`;
// located_* rows whose drop IS in OES but whose serial conflicts with OES — NOT
// promoted by D4-1 (skip-conflicts). The bulk of D4-1's 248: a serial-disagreement
// subset that needs the same owner decision as D1-5, not a silent activation.
const SQL_FLAG_D4_1_CONFLICT = `
  WITH ${OA1}
  SELECT COUNT(DISTINCT pp.id) AS n
  FROM oes_pp_data pp JOIN oa1 ON oa1.drop_number = pp.resolved_drop_number
  WHERE pp.resolution_status IN ('located_1map', 'located_local', 'located_unified')
    AND pp.serial_number IS NOT NULL AND TRIM(pp.serial_number) NOT IN ('', '-')
    AND oa1.serial_number IS NOT NULL AND TRIM(oa1.serial_number) NOT IN ('', '-')
    AND UPPER(TRIM(pp.serial_number)) <> UPPER(TRIM(oa1.serial_number))
`;

interface IdRow { id: string; drop_number?: string; serial_number?: string }

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('ERROR: DATABASE_URL not set\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    process.stdout.write(`\n=== Group C / PP-OES overlap sync backfill (#1861) ===\n`);
    process.stdout.write(`Mode:        ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN (mutations rolled back)'}\n\n`);

    await client.query('BEGIN');

    const d41 = await client.query<IdRow>(SQL_D4_1);
    process.stdout.write(`D4-1 located→activated (skip conflicts): ${d41.rowCount}\n`);
    const d44 = await client.query<IdRow>(SQL_D4_4);
    process.stdout.write(`D4-4 activated_at filled:                ${d44.rowCount}\n`);
    const d45 = await client.query<IdRow>(SQL_D4_5);
    process.stdout.write(`D4-5 drops.oes_confirmed set:            ${d45.rowCount}\n`);

    // Flag-only counts (read inside the txn, post-change so they reflect the
    // residual that still needs a human decision).
    const f15 = await client.query<{ n: string }>(SQL_FLAG_D1_5);
    const f43 = await client.query<{ n: string }>(SQL_FLAG_D4_3);
    const f41c = await client.query<{ n: string }>(SQL_FLAG_D4_1_CONFLICT);
    process.stdout.write(`\nFLAGGED (not fixed — issue #1861):\n`);
    process.stdout.write(`  D4-1 located w/ serial CONFLICT (not promoted): ${f41c.rows[0]?.n ?? '?'}\n`);
    process.stdout.write(`  D1-5 activated PP-vs-OES drop conflicts:        ${f15.rows[0]?.n ?? '?'}\n`);
    process.stdout.write(`  D4-3 activated not in OES:                      ${f43.rows[0]?.n ?? '?'}\n`);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = `/tmp/ppoes-sync-1861-snapshot-${stamp}.json`;
    fs.writeFileSync(
      snapshotPath,
      JSON.stringify(
        {
          d4_1_promoted_pp_ids: d41.rows,
          d4_4_activated_at_pp_ids: d44.rows.map((r) => r.id),
          d4_5_drops_ids: d45.rows,
        },
        null,
        2,
      ),
    );
    process.stdout.write(`\nSnapshot (for revert): ${snapshotPath}\n`);

    if (!COMMIT) {
      await client.query('ROLLBACK');
      process.stdout.write(`\nDRY RUN complete — all changes rolled back. Re-run with --commit to apply.\n`);
      return;
    }

    await client.query('COMMIT');
    process.stdout.write(`\n=== Backfill committed ===\n`);
    process.stdout.write(`D4-1=${d41.rowCount}  D4-4=${d44.rowCount}  D4-5=${d45.rowCount}\n`);
    process.stdout.write(`Snapshot for revert: ${snapshotPath}\n`);
    process.stdout.write(`Verify: re-run the D4-1/D4-4/D4-5 audit queries → 0 (D1-5/D4-3 remain by design).\n`);
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  log.error('backfill-ppoes-overlap-sync-1861: unexpected error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
