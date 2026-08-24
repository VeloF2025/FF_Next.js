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

interface ProjectIdRow extends Record<string, unknown> { id: string }

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
 */
export async function latestAggregationRun(): Promise<AggregationFreshness | null> {
  const row = await queryOne<FreshnessRow>(
    `/* fleet-operations-analytics:freshness */
     SELECT r.status,
            (SELECT MAX(a.month_start) FROM fleet_operational_monthly_aggregates_published a) AS aggregates_through
       FROM fleet_operational_aggregation_runs r
      WHERE r.finished_at IS NOT NULL
      ORDER BY r.finished_at DESC
      LIMIT 1`,
    [],
  );
  if (!row) return null;
  const through = row.aggregates_through;
  return {
    status: row.status,
    aggregatesThrough: through === null
      ? null
      : (through instanceof Date ? through.toISOString() : String(through)).slice(0, 10),
  };
}
