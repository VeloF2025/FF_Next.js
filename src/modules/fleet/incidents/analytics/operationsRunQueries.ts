/**
 * The two small reads the operations analytics response needs beside its
 * numbers: which projects a restricted viewer manages, and how fresh the
 * aggregate pipeline is.
 *
 * Freshness is reported rather than assumed. An analytics screen that shows a
 * confident total while the nightly job has been failing for a week is worse
 * than one that says so, because nothing about the numbers themselves looks
 * wrong — they are simply older than the reader believes.
 */
import { query, queryOne } from '@/lib/db-pool';
import type { IncidentScopeFilter } from '../reviewScope';
import type { RunStatus } from './aggregateSchema';
import { toWorkDate } from './sastDates';

interface ProjectIdRow extends Record<string, unknown> { id: string }

interface SiteProjectRow extends Record<string, unknown> { project_id: string | null }

/**
 * The project an operational site belongs to, so `op_site` can be scope-checked
 * by the same rule as `op_project`. A site the viewer cannot reach must be
 * refused, not answered with an empty chart that reads as "nothing happened".
 */
export async function projectIdForOperationalSite(siteId: string): Promise<string | null> {
  const row = await queryOne<SiteProjectRow>(
    `/* fleet-operations-analytics:site-project */
     SELECT project_id FROM fleet_project_operational_sites WHERE id = $1::uuid`,
    [siteId],
  );
  return row?.project_id ?? null;
}

/**
 * The projects a restricted viewer manages, by the same rule the incident queue
 * uses — `projects.project_manager` matching either the user id or the staff id,
 * because the column holds one or the other depending on how the project was
 * created.
 */
export async function listScopedProjectIds(scope: IncidentScopeFilter): Promise<string[]> {
  const rows = await query<ProjectIdRow>(
    `/* fleet-operations-analytics:scoped-projects */
     SELECT id FROM projects
      WHERE project_manager = $1::uuid OR ($2::uuid IS NOT NULL AND project_manager = $2::uuid)`,
    [scope.pmUserId, scope.pmStaffId],
  );
  return rows.map((row) => row.id);
}

export interface AggregationFreshness {
  status: RunStatus;
  /** The latest month the pipeline has actually written, not the latest it tried. */
  aggregatesThrough: string | null;
}

interface FreshnessRow extends Record<string, unknown> {
  status: RunStatus;
  aggregates_through: string | Date | null;
}

/**
 * The most recently finished aggregation run, with the newest month any active
 * aggregate covers.
 *
 * `aggregatesThrough` comes from the rows, not from the run's own bookkeeping: a
 * run can report success for a month it then declined to write (a month whose
 * presence evaluation skipped days is deliberately not stored), and a freshness
 * line that trusted the run would claim coverage that does not exist.
 *
 * It is also scoped to the metric version the response was built under. Two
 * versions of a month coexist in the table, so an unscoped MAX would report
 * coverage from a definition the numbers beside it were not computed with.
 */
export async function latestAggregationRun(metricVersion: number): Promise<AggregationFreshness | null> {
  const row = await queryOne<FreshnessRow>(
    `/* fleet-operations-analytics:freshness */
     SELECT r.status,
            (SELECT MAX(a.month_start) FROM fleet_operational_monthly_aggregates_published a
              WHERE a.metric_version = $1::int) AS aggregates_through
       FROM fleet_operational_aggregation_runs r
      WHERE r.finished_at IS NOT NULL
      ORDER BY r.finished_at DESC
      LIMIT 1`,
    [metricVersion],
  );
  if (!row) return null;
  const through = row.aggregates_through;
  return {
    status: row.status,
    // `MAX(month_start)` is a DATE, and node-postgres parses a DATE to LOCAL
    // midnight. Formatting that through UTC reports the 1st as the previous
    // month's last day, so a freshness line would understate coverage by a day
    // — and by a whole month at every month boundary.
    aggregatesThrough: through === null ? null : toWorkDate(through),
  };
}
