/**
 * Types for the metrics snapshot spine.
 *
 * A snapshot captures point-in-time state that the upstream source does not retain.
 * The OES import, for example, upserts into a table UNIQUE on drop_number, so
 * yesterday's state is gone — the only way to answer "what did this look like last
 * Tuesday" is to have written it down on Tuesday.
 */

export interface SnapshotSource {
  /** Stable key stored in metric_snapshots.source_key. Never rename in place. */
  key: string;

  /** Human description, surfaced in docs and the metric catalogue. */
  description: string;

  /**
   * SELECT returning exactly three columns: entity_id TEXT, dims JSONB, measures JSONB.
   * Must be a pure read and must NOT reference metric_snapshots.
   *
   * It is embedded in the writer's INSERT, where two parameters are already bound:
   *   $1 = source_key, $2 = as_of date
   *
   * Use `$2::date` for anything date-relative — **never `CURRENT_DATE` or `NOW()`**.
   * A snapshot is an immutable record of a specific day; deriving an age from the
   * clock instead of from as_of makes a backfilled or retried run produce different
   * measures than the original, and makes a run between 00:00 and 02:00 SAST record
   * the previous UTC day. Cast TIMESTAMPTZ columns explicitly with
   * `AT TIME ZONE 'Africa/Johannesburg'` rather than relying on the session default.
   *
   * `entity_id` MUST be unique within the source. There is no ON CONFLICT clause —
   * a duplicate raises against the unique index and aborts the transaction, so the
   * day is retried rather than silently undercounted and marked complete.
   */
  sql: string;
}

export interface SnapshotResult {
  /** Rows inserted by this call. Zero when skipped. */
  rows: number;

  /** True when this call did not write — already done, or the lock was held elsewhere. */
  skipped: boolean;

  /**
   * True only when a completion row for (source, day) is known to exist: either this
   * call wrote it, or it was already there.
   *
   * False means the day is NOT recorded and must be re-run. `skipped` alone cannot
   * express that difference — "someone else is doing it" and "it is done" are not
   * the same outcome, and treating a lost race as success lets a caller report a
   * green run over a night that was never written.
   */
  written: boolean;
}

/** Minimal surface the writer needs, so tests can supply a fake without a pool. */
export interface QueryDeps {
  query: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number }>;
}
