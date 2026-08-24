/**
 * Reads released aggregates for the months whose identifiable detail has been
 * purged.
 *
 * Everything here goes through `fleet_operational_monthly_aggregates_published`
 * (migration 525), never the base table: the view hard-codes `is_active = true`,
 * and a superseded generation is the disclosive one — a month is recomputed to
 * fewer rows exactly when the anonymity threshold is raised, so the retired
 * generation published groups now judged too small. `aggregateViewContract.test.ts`
 * fails the build if this file, or any other outside the writer, reaches past
 * the view.
 *
 * `staffId` and `vehicleId` are never accepted here. They name one person and
 * one vehicle, and an aggregate exists precisely because it describes at least
 * `k` of them; the caller enforces that with `hasRetainedOnlyFilter` before it
 * gets this far.
 *
 * WHERE clauses are explicit, parameterized branches — never conditional
 * tagged-template fragments (CLAUDE.md).
 */
import { query } from '@/lib/db-pool';
import type { IncidentScopeFilter } from '../reviewScope';
import type { AggregateDimensionLevel, OperationsMetricKey } from './aggregateSchema';
import { DURATION_BUCKET_COLUMNS } from './aggregateSchema';
import type { DurationHistogram } from './types';

export interface PublishedAggregate {
  monthStart: string;
  metricKey: OperationsMetricKey;
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  /** True when the row stands in for children that were withheld. */
  generalized: boolean;
}

interface AggregateRow extends Record<string, unknown> {
  month_start: string | Date;
  metric_key: OperationsMetricKey;
  numerator: number;
  denominator: number | null;
  sample_count: number | null;
  sum_seconds: number | null;
  generalized_from_level: AggregateDimensionLevel | null;
  bucket_0_300: number | null;
  bucket_301_900: number | null;
  bucket_901_1800: number | null;
  bucket_1801_3600: number | null;
  bucket_3601_14400: number | null;
  bucket_over_14400: number | null;
}

const AGGREGATE_COLUMNS = `month_start, metric_key, numerator, denominator, sample_count, sum_seconds,
  generalized_from_level, ${DURATION_BUCKET_COLUMNS.join(', ')}`;

/**
 * The scope predicate the incident queue uses, applied to the aggregate's own
 * project dimension so one definition of "a project I manage" serves both.
 */
const SCOPE_PREDICATE = `EXISTS (
  SELECT 1 FROM projects p
   WHERE p.id = a.dimension_project_id
     AND (p.project_manager = $3::uuid OR ($4::uuid IS NOT NULL AND p.project_manager = $4::uuid))
)`;

function monthOf(value: string | Date): string {
  return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
}

function histogramOf(row: AggregateRow): DurationHistogram | null {
  if (row.sample_count === null || row.sample_count === undefined) return null;
  return {
    sampleCount: row.sample_count,
    sumSeconds: row.sum_seconds ?? 0,
    buckets: DURATION_BUCKET_COLUMNS.map((column) => Number(row[column] ?? 0)),
  };
}

function mapRow(row: AggregateRow): PublishedAggregate {
  return {
    monthStart: monthOf(row.month_start),
    metricKey: row.metric_key,
    numerator: Number(row.numerator),
    denominator: row.denominator === null ? null : Number(row.denominator),
    histogram: histogramOf(row),
    generalized: row.generalized_from_level !== null,
  };
}

export interface AggregateDimensionRequest {
  monthStarts: readonly string[];
  metricVersion: number;
  projectId?: string;
  operationalSiteId?: string;
}

/**
 * The released rows for one dimension over a set of months.
 *
 * The level is implied by how narrow the request is — a site filter reads site
 * rows, a project filter reads that project's rows, and neither reads the
 * organisation row, which would cover projects the caller did not ask about.
 * An unrestricted viewer with no filter reads the organisation row; a
 * restricted one reads the project rows they manage and the caller sums them,
 * because there is no organisation row that means "my projects".
 */
export async function readPublishedAggregates(
  request: AggregateDimensionRequest,
  scope: IncidentScopeFilter,
): Promise<PublishedAggregate[]> {
  const months = [...request.monthStarts];
  if (months.length === 0) return [];
  const base = [months, request.metricVersion];
  const scoped = [...base, scope.pmUserId, scope.pmStaffId];

  // Five whole statements rather than one with conditional fragments. Beyond
  // CLAUDE.md's rule against those, splicing the scope predicate in or out
  // would leave $3/$4 bound but unreferenced in the unrestricted branches,
  // which Postgres reports at bind time rather than in review.
  if (request.operationalSiteId !== undefined) {
    const rows = scope.unrestricted
      ? await query<AggregateRow>(
        `/* fleet-operations-analytics:aggregates-site */
         SELECT ${AGGREGATE_COLUMNS} FROM fleet_operational_monthly_aggregates_published a
          WHERE a.month_start = ANY($1::date[]) AND a.metric_version = $2::int
            AND a.dimension_level = 'site' AND a.dimension_site_id = $3::uuid`,
        [...base, request.operationalSiteId],
      )
      : await query<AggregateRow>(
        `/* fleet-operations-analytics:aggregates-site-scoped */
         SELECT ${AGGREGATE_COLUMNS} FROM fleet_operational_monthly_aggregates_published a
          WHERE a.month_start = ANY($1::date[]) AND a.metric_version = $2::int
            AND a.dimension_level = 'site' AND a.dimension_site_id = $5::uuid
            AND ${SCOPE_PREDICATE}`,
        [...scoped, request.operationalSiteId],
      );
    return rows.map(mapRow);
  }

  if (request.projectId !== undefined) {
    const rows = scope.unrestricted
      ? await query<AggregateRow>(
        `/* fleet-operations-analytics:aggregates-project */
         SELECT ${AGGREGATE_COLUMNS} FROM fleet_operational_monthly_aggregates_published a
          WHERE a.month_start = ANY($1::date[]) AND a.metric_version = $2::int
            AND a.dimension_level = 'project' AND a.dimension_project_id = $3::uuid`,
        [...base, request.projectId],
      )
      : await query<AggregateRow>(
        `/* fleet-operations-analytics:aggregates-project-scoped */
         SELECT ${AGGREGATE_COLUMNS} FROM fleet_operational_monthly_aggregates_published a
          WHERE a.month_start = ANY($1::date[]) AND a.metric_version = $2::int
            AND a.dimension_level = 'project' AND a.dimension_project_id = $5::uuid
            AND ${SCOPE_PREDICATE}`,
        [...scoped, request.projectId],
      );
    return rows.map(mapRow);
  }

  if (scope.unrestricted) {
    const rows = await query<AggregateRow>(
      `/* fleet-operations-analytics:aggregates-organisation */
       SELECT ${AGGREGATE_COLUMNS} FROM fleet_operational_monthly_aggregates_published a
        WHERE a.month_start = ANY($1::date[]) AND a.metric_version = $2::int
          AND a.dimension_level = 'organisation'`,
      base,
    );
    return rows.map(mapRow);
  }

  const rows = await query<AggregateRow>(
    `/* fleet-operations-analytics:aggregates-managed-projects */
     SELECT ${AGGREGATE_COLUMNS} FROM fleet_operational_monthly_aggregates_published a
      WHERE a.month_start = ANY($1::date[]) AND a.metric_version = $2::int
        AND a.dimension_level = 'project' AND ${SCOPE_PREDICATE}`,
    scoped,
  );
  return rows.map(mapRow);
}
