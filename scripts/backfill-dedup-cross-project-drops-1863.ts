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
 *   1. The row that has FK children — if EXACTLY one row does, it is the keeper
 *      (it is the real, referenced row).
 *   2. If NO row has children: prefer oes_confirmed=true, then source='qfield'
 *      (real field capture over a bulk SOW import), then the oldest created_at.
 *      (When all candidates are childless duplicates they are interchangeable;
 *      this ordering just makes the choice deterministic.)
 *   3. SAFETY ABORT: if MORE THAN ONE row for a drop_number has FK children the
 *      group is ambiguous — skipped and reported in full for manual review.
 *      Likewise, if any NON-keeper is referenced, the whole group is skipped.
 *
 * The set of tables that FK-reference drops(id) is discovered at RUNTIME from
 * pg_constraint (not a hardcoded list), so it can never silently go stale as the
 * schema grows. (qa_photo_reviews joins drops by the drop_number STRING, not a
 * FK to id, and the keeper retains that same drop_number — so QA records are
 * unaffected.)
 *
 * SAFETY MODEL:
 *   - DRY RUN BY DEFAULT. Pass --commit to delete.
 *   - The child-count read, the decision, and the DELETE all run inside ONE
 *     transaction. The advisory child-count check aborts a referenced group
 *     early; the database FK constraints are the AUTHORITATIVE guard — if a
 *     concurrent write adds a child to a to-delete row after our read, the
 *     DELETE raises a foreign_key_violation and the whole transaction rolls
 *     back. A silent bad delete is therefore impossible.
 *   - If the DELETE affects a different row count than planned, ROLLBACK + exit
 *     non-zero (never report a partial delete as success).
 *   - A pre-delete snapshot of every affected row is written to /tmp for revert
 *     (same convention as the Group A backfill #1866).
 *   - Idempotent: re-running after a successful commit finds no duplicates.
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

export interface DropRow {
  id: string;
  drop_number: string;
  project_id: string | null;
  source: string | null;
  status: string | null;
  oes_confirmed: boolean | null;
  created_at: string;
  child_count: number;
}

export interface Decision {
  drop_number: string;
  keeper: DropRow;
  remove: DropRow[];
  skipped?: string; // reason, if the group is left untouched
}

interface FkRef {
  table: string;
  col: string;
}

/** Discover every (table, column) that FK-references drops(id), from the catalog. */
async function loadDropFkRefs(client: PoolClient): Promise<FkRef[]> {
  const { rows } = await client.query<{ table: string; col: string }>(
    `SELECT c.conrelid::regclass::text AS table, a.attname AS col
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f'
        AND c.confrelid = 'drops'::regclass
      ORDER BY 1, 2`,
  );
  if (rows.length === 0) {
    throw new Error('No FK references to drops found — refusing to dedup without a child-count guard');
  }
  return rows;
}

/**
 * Build the duplicate-rows SELECT, annotating each row with the total count of
 * FK children referencing it. Identifiers come from the catalog (loadDropFkRefs)
 * and are double-quoted; they are never user-supplied.
 */
function buildSelect(fkRefs: FkRef[]): string {
  const childSum = fkRefs
    .map(({ table, col }) => `(SELECT count(*) FROM ${table} t WHERE t."${col}" = d.id)`)
    .join(' + ');
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

/** Pure keeper-selection logic for one drop_number group. Exported for tests. */
export function decide(group: DropRow[]): Decision {
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
    // No children anywhere — candidates are interchangeable duplicates.
    // Deterministic order: oes_confirmed=true, then source='qfield', then oldest.
    const sorted = [...group].sort((a, b) => {
      const ac = a.oes_confirmed ? 0 : 1;
      const bc = b.oes_confirmed ? 0 : 1;
      if (ac !== bc) return ac - bc;
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

/** Group rows by drop_number, preserving query order within each group. */
export function groupByDropNumber(rows: DropRow[]): Map<string, DropRow[]> {
  const groups = new Map<string, DropRow[]>();
  for (const r of rows) {
    const g = groups.get(r.drop_number) ?? [];
    g.push(r);
    groups.set(r.drop_number, g);
  }
  return groups;
}

function fmt(r: DropRow): string {
  return `${r.id}  proj=${r.project_id ?? 'null'}  src=${r.source ?? 'null'}  status=${r.status ?? 'null'}  oes_confirmed=${r.oes_confirmed ?? 'null'}  children=${r.child_count}`;
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
    process.stdout.write(`\n=== Group E / D3-2 — cross-project duplicate drops dedup ===\n`);
    process.stdout.write(`Mode:        ${COMMIT ? 'LIVE (--commit)' : 'DRY RUN (default — no writes)'}\n`);

    // Read child-counts, decide, and DELETE inside ONE transaction. FK
    // constraints remain the authoritative delete-time guard (see header).
    await client.query('BEGIN');

    const fkRefs = await loadDropFkRefs(client);
    process.stdout.write(`FK ref tables discovered: ${fkRefs.length}\n`);

    const { rows } = await client.query<DropRow>(buildSelect(fkRefs));
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      process.stdout.write(`\nNo duplicate drop_numbers — clean.\n`);
      return;
    }

    const groups = groupByDropNumber(rows);
    const decisions = [...groups.values()].map(decide);
    const skipped = decisions.filter((d) => d.skipped);
    const toRemove = decisions.filter((d) => !d.skipped).flatMap((d) => d.remove);

    process.stdout.write(`Duplicate drop_numbers: ${groups.size}\n`);
    process.stdout.write(`Rows to delete:         ${toRemove.length}\n`);
    process.stdout.write(`Groups skipped:         ${skipped.length}\n\n`);

    for (const d of decisions) {
      const group = groups.get(d.drop_number) ?? [];
      process.stdout.write(`${d.drop_number}:\n`);
      if (d.skipped) {
        // Print the WHOLE group so the operator can act on the manual-review case.
        process.stdout.write(`  SKIP (${d.skipped}):\n`);
        for (const r of group) {
          const mark = r.id === d.keeper.id ? 'keeper?' : 'row';
          process.stdout.write(`    ${mark.padEnd(8)} ${fmt(r)}\n`);
        }
      } else {
        process.stdout.write(`  KEEP   ${fmt(d.keeper)}\n`);
        for (const r of d.remove) process.stdout.write(`  DELETE ${fmt(r)}\n`);
      }
    }

    if (toRemove.length === 0) {
      await client.query('ROLLBACK');
      process.stdout.write(`\nNothing actionable.\n`);
      return;
    }

    // Pre-delete snapshot (both modes) for revert reference.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = `/tmp/dedup-drops-1863-snapshot-${stamp}.json`;
    fs.writeFileSync(snapshotPath, JSON.stringify(toRemove, null, 2));
    process.stdout.write(`\nSnapshot of rows to delete: ${snapshotPath}\n`);

    if (!COMMIT) {
      await client.query('ROLLBACK');
      process.stdout.write(`\nDRY RUN complete. No rows changed. Re-run with --commit to apply.\n`);
      return;
    }

    const ids = toRemove.map((r) => r.id);
    const res = await client.query(`DELETE FROM drops WHERE id = ANY($1::uuid[])`, [ids]);
    if (res.rowCount !== ids.length) {
      await client.query('ROLLBACK');
      process.stderr.write(
        `\nABORT: DELETE affected ${res.rowCount} rows but ${ids.length} were planned — rolled back, no change.\n`,
      );
      process.exit(1);
    }
    await client.query('COMMIT');
    process.stdout.write(`\n=== Dedup complete ===\nDeleted: ${res.rowCount} rows (matched plan of ${ids.length})\n`);
    process.stdout.write(`Snapshot for revert: ${snapshotPath}\n`);
    process.stdout.write(`Verify: SELECT drop_number, count(*) FROM drops GROUP BY drop_number HAVING count(*)>1; -> 0 rows\n`);
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run when invoked directly (allows the pure helpers above to be unit-tested).
if (process.argv[1] && process.argv[1].includes('backfill-dedup-cross-project-drops-1863')) {
  main().catch((err: unknown) => {
    log.error('backfill-dedup-cross-project-drops-1863: unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
