/**
 * Reads released aggregates for the months whose identifiable detail has been
 * purged.
 *
 * Everything here goes through `fleet_operational_monthly_aggregates_published`
 * (migration 527), never the base table: the view hard-codes `is_active = true`,
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
 * tagged-template fragments (CLAUDE.md). The parameter numbering the branches
 * share is defined once, in `EXTRA_PARAM` and `extraParams` below, because a
 * branch whose SQL says `$3` while its caller binds the value fourth fails only
 * at run time and only for the viewer that branch belongs to.
 */
import { query } from '@/lib/db-pool';
import type { IncidentScopeFilter } from '../reviewScope';
import type { AggregateDimensionLevel, OperationsMetricKey } from './aggregateSchema';
import { DURATION_BUCKET_COLUMNS } from './aggregateSchema';
import { toWorkDate } from './sastDates';
import type { DurationHistogram } from './types';

export interface PublishedAggregate {
  monthStart: string;
  /** The project this row is about; null on the organisation row. */
  dimensionProjectId: string | null;
  metricKey: OperationsMetricKey;
  numerator: number;
  denominator: number | null;
  histogram: DurationHistogram | null;
  /** True when the row stands in for children that were withheld. */
  generalized: boolean;
}

interface AggregateRow extends Record<string, unknown> {
  month_start: string | Date;
  dimension_project_id: string | null;
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

const AGGREGATE_COLUMNS = `month_start, dimension_project_id, metric_key, numerator, denominator,
  sample_count, sum_seconds, generalized_from_level, ${DURATION_BUCKET_COLUMNS.join(', ')}`;

const PUBLISHED_VIEW = 'fleet_operational_monthly_aggregates_published a';
const MONTH_AND_VERSION = 'a.month_start = ANY($1::date[]) AND a.metric_version = $2::int';

/**
 * The scope predicate the incident queue uses, applied to the aggregate's own
 * project dimension so one definition of "a project I manage" serves both.
 */
const SCOPE_PREDICATE = `EXISTS (
  SELECT 1 FROM projects p
   WHERE p.id = a.dimension_project_id
     AND (p.project_manager = $3::uuid OR ($4::uuid IS NOT NULL AND p.project_manager = $4::uuid))
)`;

/**
 * Where a branch's own parameters land. An unrestricted branch binds nothing
 * for scope, so its first parameter is third; a scoped branch has spent $3 and
 * $4 on the scope predicate, so its first is fifth. Postgres refuses a bind
 * whose count does not match the statement, which is why the scope parameters
 * cannot simply always be supplied.
 */
const EXTRA_PARAM = {
  unrestricted: ['$3', '$4'] as const,
  scoped: ['$5', '$6'] as const,
} as const;

/** `EXTRA_PARAM` read positionally, so a statement and its binds cannot drift. */
function slot(kind: 'unrestricted' | 'scoped', index: 0 | 1): string {
  return EXTRA_PARAM[kind][index];
}

function statement(tag: string, where: string): string {
  return `/* fleet-operations-analytics:${tag} */
     SELECT ${AGGREGATE_COLUMNS} FROM ${PUBLISHED_VIEW}
      WHERE ${MONTH_AND_VERSION} AND ${where}`;
}

const SQL = {
  site: statement('aggregates-site',
    `a.dimension_level = 'site' AND a.dimension_site_id = ${slot('unrestricted', 0)}::uuid`),
  siteScoped: statement('aggregates-site-scoped',
    `a.dimension_level = 'site' AND a.dimension_site_id = ${slot('scoped', 0)}::uuid AND ${SCOPE_PREDICATE}`),
  // op_site and op_project together are not redundant: a site id the caller
  // does not own would otherwise be answered from its own project's rows.
  siteInProject: statement('aggregates-site-in-project',
    `a.dimension_level = 'site' AND a.dimension_site_id = ${slot('unrestricted', 0)}::uuid
      AND a.dimension_project_id = ${slot('unrestricted', 1)}::uuid`),
  siteInProjectScoped: statement('aggregates-site-in-project-scoped',
    `a.dimension_level = 'site' AND a.dimension_site_id = ${slot('scoped', 0)}::uuid
      AND a.dimension_project_id = ${slot('scoped', 1)}::uuid AND ${SCOPE_PREDICATE}`),
  project: statement('aggregates-project',
    `a.dimension_level = 'project' AND a.dimension_project_id = ${slot('unrestricted', 0)}::uuid`),
  projectScoped: statement('aggregates-project-scoped',
    `a.dimension_level = 'project' AND a.dimension_project_id = ${slot('scoped', 0)}::uuid AND ${SCOPE_PREDICATE}`),
  projectList: statement('aggregates-project-list',
    `a.dimension_level = 'project' AND a.dimension_project_id = ANY(${slot('unrestricted', 0)}::uuid[])`),
  projectListScoped: statement('aggregates-project-list-scoped',
    `a.dimension_level = 'project' AND a.dimension_project_id = ANY(${slot('scoped', 0)}::uuid[])
      AND ${SCOPE_PREDICATE}`),
  organisation: statement('aggregates-organisation', `a.dimension_level = 'organisation'`),
  managedProjects: statement('aggregates-managed-projects',
    `a.dimension_level = 'project' AND ${SCOPE_PREDICATE}`),
} as const;

/** The bind list for a branch that carries parameters of its own, in `slot` order. */
function extraParams(
  base: readonly unknown[], scope: IncidentScopeFilter, ...extras: unknown[]
): unknown[] {
  return scope.unrestricted
    ? [...base, ...extras]
    : [...base, scope.pmUserId, scope.pmStaffId, ...extras];
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
    // `month_start` is a DATE, which node-postgres parses to LOCAL midnight;
    // formatting that through UTC reports the 1st as the previous month's last
    // day and files the row under a month the caller never asked for.
    monthStart: toWorkDate(row.month_start),
    dimensionProjectId: row.dimension_project_id,
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
  /** The project set an `op_manager` filter resolved to. Never a single person. */
  projectIds?: readonly string[];
  operationalSiteId?: string;
}

function selectFor(
  request: AggregateDimensionRequest, scope: IncidentScopeFilter, base: readonly unknown[],
): { text: string; params: unknown[] } {
  if (request.operationalSiteId !== undefined) {
    if (request.projectId !== undefined) {
      return {
        text: scope.unrestricted ? SQL.siteInProject : SQL.siteInProjectScoped,
        params: extraParams(base, scope, request.operationalSiteId, request.projectId),
      };
    }
    return {
      text: scope.unrestricted ? SQL.site : SQL.siteScoped,
      params: extraParams(base, scope, request.operationalSiteId),
    };
  }
  if (request.projectId !== undefined) {
    return {
      text: scope.unrestricted ? SQL.project : SQL.projectScoped,
      params: extraParams(base, scope, request.projectId),
    };
  }
  if (request.projectIds !== undefined) {
    return {
      text: scope.unrestricted ? SQL.projectList : SQL.projectListScoped,
      params: extraParams(base, scope, [...request.projectIds]),
    };
  }
  if (scope.unrestricted) return { text: SQL.organisation, params: [...base] };
  return { text: SQL.managedProjects, params: [...base, scope.pmUserId, scope.pmStaffId] };
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
  const { text, params } = selectFor(request, scope, [months, request.metricVersion]);
  const rows = await query<AggregateRow>(text, params);
  return rows.map(mapRow);
}
