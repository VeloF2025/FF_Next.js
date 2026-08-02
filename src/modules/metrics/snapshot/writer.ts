import { log } from '@/lib/logger';
import { findSource } from './sources';
import type { QueryDeps, SnapshotResult } from './types';

/**
 * Write one day's snapshot for `sourceKey`, exactly once.
 *
 * Concurrency: a transaction-scoped advisory lock, taken with the non-blocking
 * `pg_try_advisory_xact_lock`. Everything happens in one transaction, so:
 *   - two concurrent runs     → the second gets `false` IMMEDIATELY and reports
 *                               written:false (no unbounded wait on a unique index)
 *   - crash / disconnect      → lock auto-released, no snapshot_runs row written,
 *                               so the next run retries. No stuck state to reclaim
 *                               and no lease to expire.
 *   - already done            → a snapshot_runs row exists → skip, written:true
 *   - previous attempt failed → no snapshot_runs row → retry
 *
 * There is deliberately NO status machine and NO failure marker. Absence of a
 * snapshot_runs row IS the retry signal. An earlier design used a claim row with
 * running/failed states; it produced unbounded lock waiting, an unreclaimable
 * 'running' state, a stale failure marker able to overwrite a later success, and a
 * documented recovery path that could not actually occur. Do not reintroduce it.
 *
 * A pre-count on metric_snapshots is NOT a substitute: it cannot distinguish a
 * COMPLETE snapshot from a PARTIAL one, so a half-written day would be skipped
 * forever and silently under-report.
 */
export async function writeSnapshot(
  sourceKey: string,
  asOf: string,
  deps: QueryDeps,
): Promise<SnapshotResult> {
  const source = findSource(sourceKey);
  if (!source) {
    throw new Error(`unknown snapshot source: ${sourceKey}`);
  }

  await deps.query('BEGIN');
  try {
    // Non-blocking. hashtext() is stable within a major version; a collision across
    // two different (source, date) pairs only costs one skipped run, which is
    // reported as written:false and re-run — it can never corrupt data.
    const lock = await deps.query(
      `SELECT pg_try_advisory_xact_lock(hashtext($1 || ':' || $2)) AS locked`,
      [sourceKey, asOf],
    );
    if ((lock.rows?.[0] as { locked?: boolean } | undefined)?.locked !== true) {
      // Losing the lock is not success: the winner may still roll back, and on a
      // hash collision the holder is a different source entirely.
      await deps.query('ROLLBACK');
      log.warn('Snapshot lock held by a concurrent run — not written', { sourceKey, asOf });
      return { rows: 0, skipped: true, written: false };
    }

    const done = await deps.query(
      `SELECT 1 FROM snapshot_runs WHERE source_key = $1 AND as_of_date = $2::date`,
      [sourceKey, asOf],
    );
    if (done.rows?.length) {
      await deps.query('ROLLBACK');
      log.info('Snapshot already complete — skipping', { sourceKey, asOf });
      return { rows: 0, skipped: true, written: true };
    }

    // Clear anything a previous rolled-back attempt somehow left, so this is a
    // clean write rather than a partial merge.
    await deps.query(
      `DELETE FROM metric_snapshots WHERE source_key = $1 AND as_of_date = $2::date`,
      [sourceKey, asOf],
    );

    // Deliberately NO "ON CONFLICT DO NOTHING": a duplicate entity_id means the
    // source's key is not unique, and silently dropping the row before recording
    // the day complete would bake in an undercount permanently. Let the unique
    // index raise and abort so the day is retried.
    const inserted = await deps.query(
      `INSERT INTO metric_snapshots (source_key, as_of_date, entity_id, dims, measures)
       SELECT $1, $2::date, s.entity_id, s.dims, s.measures FROM (${source.sql}) s`,
      [sourceKey, asOf],
    );
    const rows = inserted.rowCount ?? 0;

    await deps.query(
      `INSERT INTO snapshot_runs (source_key, as_of_date, row_count) VALUES ($1, $2::date, $3)`,
      [sourceKey, asOf, rows],
    );

    await deps.query('COMMIT');
    log.info('Snapshot written', { sourceKey, asOf, rows });
    return { rows, skipped: false, written: true };
  } catch (error) {
    // Roll back, but never let a rollback failure mask the original error.
    try {
      await deps.query('ROLLBACK');
    } catch (rollbackError) {
      log.error('Snapshot rollback failed', { sourceKey, asOf, rollbackError });
    }
    throw error;
  }
}
