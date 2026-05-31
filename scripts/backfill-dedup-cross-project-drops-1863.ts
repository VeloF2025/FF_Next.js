#!/usr/bin/env tsx
/**
 * backfill-dedup-cross-project-drops-1863.ts — Group E / D3-2 (issue #1863).
 *
 * Removes cross-project duplicate `drops` rows: the same drop_number imported
 * under multiple project_id UUIDs (the UNIQUE(project_id, drop_number)
 * constraint permits this, so the same physical drop got duplicated across
 * projects via repeated SOW imports). The audit found DR1753212/13/14 each
 * present 4× (one source='qfield', three source='sow'), inflating join fan-out
 * in any drop_number-keyed aggregate.
 *
 * KEEPER SELECTION (per drop_number, deterministic, no guessing):
 *   1. The row that has FK children (oes_activations, checklist_items, etc.) —
 *      if EXACTLY one row does, it is the keeper (it is the real, referenced row).
 *   2. If NO row has children: prefer source='qfield' (real field capture over a
 *      bulk SOW import), then the oldest created_at.
 *   3. SAFETY ABORT: if MORE THAN ONE row for a drop_number has FK children, the
 *      group is ambiguous — skipped and reported for manual review (never
 *      auto-deleted). Likewise, every NON-keeper must have ZERO FK children; if a
 *      non-keeper is referenced, the whole group is skipped.
 *
 * Children are counted across all 9 tables that FK-reference drops(id):
 *   pon_change_log, checklist_items, customer_invoice_items, drop_submissions,
 *   notification_logs, oes_activations, quality_metrics,
 *   spare_usage_log(replaced_drop_id|spare_drop_id).
 * (qa_photo_reviews joins drops by the drop_number STRING, not a FK to id, and
 * the keeper retains that same drop_number — so QA records are unaffected.)
 *
 * SAFETY: DRY RUN BY DEFAULT. Pass --commit to delete. A pre-delete snapshot of
 * every affected row (full row JSON) is written to /tmp for manual revert.
 * Deletes run in ONE transaction (all-or-nothing). Idempotent: re-running after
 * a successful commit finds no duplicates.
 *
 * Usage:
 *   npx tsx scripts/backfill-dedup-cross-project-drops-1863.ts            # dry run
 *   npx tsx scripts/backfill-dedup-cross-project-drops-1863.ts --commit   # LIVE
 *
 * DATABASE_URL must point at the target DB (shared Supabase). Controller-run,
 * after-hours only — touches production data.
 */
import { Pool, type PoolClient } from 'pg';
import * as fs from 'node:fs';
import { log } from '@/lib/logger';

const COMMIT = process.argv.includes('--commit');

// All tables (+ column) that FK-reference drops(id). Used to compute, per
// candidate row, whether anything points at it.
const FK_REFS: ReadonlyArray<{ table: string; col: string }> = [
  { table: 'pon_change_log', col: 'drop_id' },
  { table: 'checklist_items', col: 'drop_id' },
  { table: 'customer_invoice_items', col: 'drop_id' },
  { table: 'drop_submissions', col: 'drop_id' },
  { table: 'notification_logs', col: 'drop_id' },
  { table: 'oes_activations', col: 'drop_id' },
  { table: 'quality_metrics', col: 'drop_id' },
  { table: 'spare_usage_log', col: 'replaced_drop_id' },
  { table: 'spare_usage_log', col: 'spare_drop_id' },
];

interface DropRow {
  id: string;
  drop_number: string;
  project_id: string | null;
  source: string | null;
  status: string | null;
  oes_confirmed: boolean | null;
  created_at: string;
  child_count: number;
}

// Build a single SELECT that returns every drops row whose drop_number is
// duplicated, annotated with the total number of FK children referencing it.
function buildSelect(): string {
  const childSum = FK_REFS.map(
    ({ table, col }) =>
      `(SELECT count(*) FROM ${table} t WHERE t.${col} = d.id)`,
  ).join(' + ');
  return `
    WITH dups AS (
      SELECT drop_number FROM drops GROUP BY drop_number HAVING count(*) > 1
    )
    SELECT d.id,
           d.drop_number,
           d.project_id,
           d.source,
           d.status,
           d.oes_confirmed,
           d.created_at::text AS created_at,
           (${childSum})::int AS child_count
    FROM drops d
    JOIN dups ON dups.drop_number = d.drop_number
    ORDER BY d.drop_number, d.created_at
  `;
}

interface Decision {
  drop_number: string;
  keeper: DropRow;
  remove: DropRow[];
  skipped?: string; // reason, if the group is left untouched
}

function decide(group: DropRow[]): Decision {
  const drop_number = group[0].drop_number;
  const withChildren = group.filter((r) => r.child_count > 0);

  if (withChildren.length > 1) {
    return {
      drop_number,
      keeper: withChildren[0],
      remove: [],
      skipped: `${withChildren.length} rows have FK children — ambiguous, manual review`,
    };
  }

  let keeper: DropRow;
  if (withChildren.length === 1) {
    keeper = withChildren[0];
  } else {
    // No children anywhere: prefer source='qfield', then oldest created_at.
    const sorted = [...group].sort((a, b) => {
      const aq = a.source === 'qfield' ? 0 : 1;
      const bq = b.source === 'qfield' ? 0 : 1;
      if (aq !== bq) return aq - bq;
      return a.created_at.localeCompare(b.created_at);
    });
    keeper = sorted[0];
  }

  const remove = group.filter((r) => r.id !== keeper.id);
  const referencedNonKeeper = remove.find((r) => r.child_count > 0);
  if (referencedNonKeeper) {
    return {
      drop_number,
      keeper,
      remove: [],
      skipped: `non-keeper ${referencedNonKeeper.id} has FK children — manual review`,
    };
  }
  return { drop_number, keeper, remove };
}

function fmt(r: DropRow): string {
  return `${r.id}  proj=${r.project_id ?? 'null'}  src=${r.source ?? 'null'}  status=${r.status ?? 'null'}  children=${r.child_count}`;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('ERROR: DATABASE_URL not set\n');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query<DropRow>(buildSelect());

    process.stdout.write(`\n=== Group E / D3-2 — cross-project duplicate drops dedup ===\n`);
    process.stdout.write(`Mode:        ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN (default — no writes)'}\n`);

    if (rows.length === 0) {
      process.stdout.write(`\nNo duplicate drop_numbers — clean.\n`);
      return;
    }

    // Group by drop_number.
    const groups = new Map<string, DropRow[]>();
    for (const r of rows) {
      const g = groups.get(r.drop_number) ?? [];
      g.push(r);
      groups.set(r.drop_number, g);
    }

    const decisions = [...groups.values()].map(decide);
    const actionable = decisions.filter((d) => !d.skipped && d.remove.length > 0);
    const skipped = decisions.filter((d) => d.skipped);
    const toRemove = actionable.flatMap((d) => d.remove);

    process.stdout.write(`Duplicate drop_numbers: ${groups.size}\n`);
    process.stdout.write(`Rows to delete:         ${toRemove.length}\n`);
    process.stdout.write(`Groups skipped:         ${skipped.length}\n\n`);

    for (const d of decisions) {
      process.stdout.write(`${d.drop_number}:\n`);
      process.stdout.write(`  KEEP   ${fmt(d.keeper)}\n`);
      if (d.skipped) {
        process.stdout.write(`  SKIP   (${d.skipped})\n`);
      } else {
        for (const r of d.remove) process.stdout.write(`  DELETE ${fmt(r)}\n`);
      }
    }

    if (toRemove.length === 0) {
      process.stdout.write(`\nNothing actionable.\n`);
      return;
    }

    // Pre-delete snapshot (both modes) for revert reference.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = `/tmp/dedup-drops-1863-snapshot-${stamp}.json`;
    fs.writeFileSync(snapshotPath, JSON.stringify(toRemove, null, 2));
    process.stdout.write(`\nSnapshot of rows to delete: ${snapshotPath}\n`);

    if (!COMMIT) {
      process.stdout.write(`\nDRY RUN complete. No rows changed. Re-run with --commit to apply.\n`);
      return;
    }

    const ids = toRemove.map((r) => r.id);
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query(`DELETE FROM drops WHERE id = ANY($1::uuid[])`, [ids]);
      await client.query('COMMIT');
      process.stdout.write(`\n=== Dedup complete ===\nDeleted: ${res.rowCount} rows (expected ${ids.length})\n`);
      process.stdout.write(`Snapshot for revert: ${snapshotPath}\n`);
      process.stdout.write(`Verify: SELECT drop_number, count(*) FROM drops GROUP BY drop_number HAVING count(*)>1; -> 0 rows\n`);
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  log.error('backfill-dedup-cross-project-drops-1863: unexpected error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
