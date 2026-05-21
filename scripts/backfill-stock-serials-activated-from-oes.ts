#!/usr/bin/env tsx
import { Pool } from 'pg';
import { log } from '../src/lib/logger';
import type { BackfillResult } from './backfill-types';

interface Opts { pool: Pool; commit: boolean; }

/**
 * For every oes_pp_data row, mark the matching stock_serials row as
 * status='activated' and set activated_at_olt_id = oes.olt_name.
 *
 * "Latest per serial" is enforced via DISTINCT ON (serial_number)
 * ORDER BY activated_at DESC — the newest OES row wins.
 *
 * Never downgrades from faulty, in_repair, or scrapped.
 * Idempotent: only touches rows where status <> 'activated' OR olt_id changed.
 */
export async function backfillActivationsFromOES(
  opts: Opts,
): Promise<BackfillResult> {
  const { pool, commit } = opts;

  // Statuses that may be promoted to 'activated'. Must mirror PR-6's trigger
  // (spec §State machine) — see oes-activations.test.ts notes block.
  const ALLOWED_FROM: string[] = [
    'available',
    'installed',
    'issued',
    'activated',          // re-entry to update OLT pointer; guarded by IS DISTINCT FROM
  ];

  // DISTINCT ON picks the latest OES row per serial.
  const selectCandidates = `
    SELECT DISTINCT ON (oes.serial_number)
      oes.serial_number,
      oes.olt_name
    FROM oes_pp_data oes
    WHERE oes.serial_number IS NOT NULL
    ORDER BY oes.serial_number, oes.activated_at DESC`;

  if (!commit) {
    const c = await pool.query(
      `WITH cand AS (${selectCandidates})
       SELECT COUNT(*)
       FROM cand c
       JOIN stock_serials s ON s.serial_number = c.serial_number
       WHERE s.status = ANY($1::text[])
         AND (s.status <> 'activated'
              OR s.activated_at_olt_id IS DISTINCT FROM c.olt_name)`,
      [ALLOWED_FROM],
    );
    return { updated: 0, wouldUpdate: Number(c.rows[0].count) };
  }

  const r = await pool.query(
    `WITH cand AS (${selectCandidates})
     UPDATE stock_serials s
        SET status              = 'activated',
            activated_at_olt_id = c.olt_name,
            updated_at          = NOW()
       FROM cand c
      WHERE s.serial_number = c.serial_number
        AND s.status = ANY($1::text[])
        AND (s.status <> 'activated'
             OR s.activated_at_olt_id IS DISTINCT FROM c.olt_name)
     RETURNING s.id`,
    [ALLOWED_FROM],
  );

  log.info('backfill-activations done', { updated: r.rowCount });
  return { updated: r.rowCount ?? 0, wouldUpdate: 0 };
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillActivationsFromOES({ pool, commit });
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
