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
 * Never downgrades terminal/quarantine states (faulty, scrapped, in_repair,
 * returned) or in-flight states (reserved, allocated_to_project, in_transit).
 * See ALLOWED_FROM below for the full scope rationale.
 * Idempotent: only touches rows where status <> 'activated' OR olt_name changed.
 */
export async function backfillActivationsFromOES(
  opts: Opts,
): Promise<BackfillResult> {
  const { pool, commit } = opts;

  // Statuses that may be promoted to 'activated' by this backfill.
  // Scope rationale (kept narrow per commit 46fc86a60 to mirror the PR-6
  // trigger that will enforce these transitions live):
  //   - 'available', 'issued', 'installed' are the canonical pre-activation
  //     states from the spec §State machine. A serial in any of these states
  //     is legitimately reachable on the network and may light up in OES.
  //   - 'activated' is included to enable OLT-pointer corrections: a serial
  //     activated against the wrong olt_name can be re-pointed by a fresh
  //     OES row. The IS DISTINCT FROM guard below keeps this idempotent —
  //     when the OLT already matches, no row is updated.
  // The implicit exclusion list (every status NOT in this array) is what
  // prevents downgrades from terminal / quarantine / in-flight states:
  // 'faulty', 'scrapped', 'in_repair', 'returned', 'reserved',
  // 'allocated_to_project', and 'in_transit' are never touched here. The
  // in-flight states are deliberately excluded — promoting them via a
  // bulk historical backfill would mask dispatch/logistics bugs; PR-6's
  // live trigger will handle them with proper event-log audit trails.
  const ALLOWED_FROM: string[] = [
    'available',
    'installed',
    'issued',
    'activated',          // re-entry to update OLT pointer; guarded by IS DISTINCT FROM
  ];

  // DISTINCT ON picks the latest OES row per serial.
  // Prod schema correction (PR-7): oes_pp_data has no `activated_at` column.
  // The closest timestamp is `created_at` (when the row was imported).
  // `date_registered` is a DATE (not TIMESTAMPTZ) and loses time precision,
  // so created_at is the better ordering key.
  const selectCandidates = `
    SELECT DISTINCT ON (oes.serial_number)
      oes.serial_number,
      oes.olt_name
    FROM oes_pp_data oes
    WHERE oes.serial_number IS NOT NULL
    ORDER BY oes.serial_number, oes.created_at DESC`;

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

// No --limit flag: the backfill is a single atomic SQL UPDATE driven by a
// CTE, so chunking would not reduce lock duration meaningfully and would
// complicate idempotency reasoning. If row-count ever justifies batching,
// add a serial_number-range filter rather than LIMIT (which interacts
// poorly with DISTINCT ON ordering).
async function main() {
  const commit = process.argv.includes('--commit');
  const url = process.env.DATABASE_URL;
  if (!url) { process.stderr.write('DATABASE_URL not set\n'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  try {
    const r = await backfillActivationsFromOES({ pool, commit });
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) { main(); }
