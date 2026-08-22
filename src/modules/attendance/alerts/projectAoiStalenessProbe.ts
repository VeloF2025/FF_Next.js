/**
 * The database half of the project-AOI liveness check. See
 * `./projectAoiStaleness` for why this exists and where it is hosted.
 *
 * Two round trips, both trivial: `project_aois` holds one row per project (9
 * today), and the catalog lookup hits cached system tables. That matters
 * because the host, `/api/cron/db-health`, runs every minute against
 * production.
 *
 * The catalog query is the migration-523 guard. 523 is not applied everywhere
 * yet, so `aoi_status` may not exist at runtime; selecting it unconditionally
 * would raise 42703 on every probe until the migration lands. Two explicit
 * query variants rather than one interpolated statement — a conditional SQL
 * fragment is exactly the shape that breaks the tagged-template callers in this
 * repo (see CLAUDE.md), and two named constants are also two things a test can
 * run verbatim.
 *
 * `to_regclass` and the `pg_attribute` lookup are search_path-relative on
 * purpose, not pinned to `public`: that is what lets the migration test run
 * these exact strings against a scratch schema.
 */
import { classifyAoiFreshness, type AoiFreshness } from './projectAoiStaleness';

/** Does the table exist, and has migration 523 landed on it? */
export const AOI_CATALOG_SQL = `
  SELECT
    to_regclass('project_aois') IS NOT NULL AS has_table,
    EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = to_regclass('project_aois')
         AND attname = 'aoi_status'
         AND attnum > 0
         AND NOT attisdropped
    ) AS has_status
`;

// Aggregates with no GROUP BY always return exactly one row, including over an
// empty table — so "the refresh has never run" arrives as row_count 0 and a
// null timestamp, not as an empty result the caller has to special-case.
export const AOI_STATE_WITH_STATUS_SQL = `
  SELECT COUNT(*)::int AS row_count,
         MAX(computed_at)::text AS newest_computed_at,
         COUNT(*) FILTER (WHERE aoi_status = 'unassessed')::int AS unscored_count
    FROM project_aois
`;

/** Pre-523 variant. No aoi_status column exists, so nothing can be unscored. */
export const AOI_STATE_WITHOUT_STATUS_SQL = `
  SELECT COUNT(*)::int AS row_count,
         MAX(computed_at)::text AS newest_computed_at,
         0 AS unscored_count
    FROM project_aois
`;

export interface AoiCatalogRow { has_table: boolean; has_status: boolean }
export interface AoiStateRow {
  row_count: number;
  newest_computed_at: string | null;
  unscored_count: number;
}

export type AoiProbeQuery = <R>(text: string) => Promise<R[]>;

/**
 * Reads the two queries and classifies the result.
 *
 * Throws only what the caller's query function throws — db-health wraps this in
 * its own try/catch so a failure here can never affect the database verdict.
 */
export async function probeAoiFreshness(query: AoiProbeQuery, nowMs: number): Promise<AoiFreshness> {
  const catalog = await query<AoiCatalogRow>(AOI_CATALOG_SQL);
  if (!catalog[0]?.has_table) {
    return {
      state: 'unknown', newestComputedAt: null, ageMs: null, rowCount: 0, unscoredCount: 0,
      detail: 'project_aois does not exist here — migration 499 has not been applied',
    };
  }

  const hasStatus = catalog[0].has_status === true;
  const rows = await query<AoiStateRow>(hasStatus ? AOI_STATE_WITH_STATUS_SQL : AOI_STATE_WITHOUT_STATUS_SQL);
  const row = rows[0];
  if (!row) {
    return {
      state: 'unknown', newestComputedAt: null, ageMs: null, rowCount: 0, unscoredCount: 0,
      detail: 'the project_aois state query returned no row',
    };
  }

  return classifyAoiFreshness(
    {
      newestComputedAt: row.newest_computed_at,
      rowCount: Number(row.row_count),
      // Pre-523 this is the literal 0 above, so an unscored count can never be
      // inferred from a column that does not exist yet.
      unscoredCount: Number(row.unscored_count),
    },
    nowMs,
  );
}
