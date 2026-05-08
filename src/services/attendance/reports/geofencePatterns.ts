/**
 * geofence-patterns report (Phase 1 spec 2026-05-08).
 *
 * One row per active staff member. Each row carries:
 *   - clock-in volume in the date range
 *   - % inside any active staff_projects polygon (zone_boundaries.geom)
 *   - % inside an office geofence (fleet_authorized_locations type='office')
 *   - % unmatched
 *   - distinct project polygons hit + per-project share
 *   - suggested archetype (from suggestArchetype)
 *   - proposed department-default archetype (from proposedDepartmentDefaults)
 *   - mismatch flag + the three data-gap flags from the spec
 *
 * Read-only; no writes anywhere.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { ReportTooLargeError, REPORT_ROW_CAP } from './runner';
import { makeParamBuilder } from './sqlHelpers';
import type { ReportColumn, ReportInput, ReportRunResult } from './types';
import { suggestArchetype, type ArchetypeMetrics } from '../archetype/suggestArchetype';
import { proposedDepartmentDefault } from '../archetype/proposedDepartmentDefaults';
import type { ArchetypeResolved } from '../archetype/types';

const COLUMNS: ReadonlyArray<ReportColumn> = [
  { key: 'staff', label: 'Staff' },
  { key: 'department', label: 'Dept' },
  { key: 'total_clock_ins', label: 'Clock-ins', align: 'right', format: 'integer' },
  { key: 'pct_inside_any_assigned', label: '% inside assigned polygon', align: 'right', format: 'number' },
  { key: 'pct_inside_office', label: '% inside office', align: 'right', format: 'number' },
  { key: 'pct_unmatched', label: '% unmatched', align: 'right', format: 'number' },
  { key: 'distinct_polygons_hit', label: '# polygons hit', align: 'right', format: 'integer' },
  { key: 'max_single_project_pct', label: 'Top polygon %', align: 'right', format: 'number' },
  { key: 'suggested_archetype', label: 'Suggested archetype' },
  { key: 'proposed_default_archetype', label: 'Dept default (proposed)' },
  { key: 'mismatch', label: 'Mismatch?' },
  { key: 'low_signal', label: 'Low signal?' },
  { key: 'data_gap_no_assignments', label: 'Project staff w/o assignments?' },
  { key: 'data_gap_no_home_site', label: 'Office staff w/o home_site_id?' },
];

interface InputArgs {
  dateFrom: string;
  dateTo: string;
  departments: string[];
  scopedStaffIds: string[] | null;
}

interface DbRow extends Record<string, unknown> {
  staff_id: string;
  full_name: string;
  department: string | null;
  home_site_id: string | null;
  active_assignment_count: number;
  total_clock_ins: number;
  inside_any_assigned: number;
  inside_office: number;
  unmatched: number;
  distinct_polygons_hit: number;
  /** project_id (text) → raw clock-in hit count. Percentages computed in TS. */
  per_project_hits_json: string | Record<string, number> | null;
}

/**
 * Pure SQL builder. Returns `{ text, params }` so the unit test can
 * assert structure without hitting a DB.
 */
export function buildGeofencePatternsSql(args: InputArgs): { text: string; params: unknown[] } {
  const pb = makeParamBuilder();
  const dateFromP = pb.next(args.dateFrom);
  const dateToP = pb.next(args.dateTo);

  const deptClause =
    args.departments.length > 0
      ? `AND s.department = ANY(${pb.next(args.departments)}::text[])`
      : '';
  const staffScopeClause =
    args.scopedStaffIds !== null
      ? `AND s.id = ANY(${pb.next(args.scopedStaffIds)}::uuid[])`
      : '';

  const text = `
    WITH clock_ins AS (
      SELECT
        ae.id,
        ae.staff_id,
        ae.clock_in_lat,
        ae.clock_in_lon,
        ST_SetSRID(ST_MakePoint(ae.clock_in_lon::float8, ae.clock_in_lat::float8), 4326) AS pt
      FROM attendance_entries ae
      WHERE ae.work_date >= ${dateFromP}::date
        AND ae.work_date <= ${dateToP}::date
        AND ae.clock_in_lat IS NOT NULL
        AND ae.clock_in_lon IS NOT NULL
    ),
    per_staff_polygon_hits AS (
      SELECT
        ci.staff_id,
        ci.id AS clock_in_id,
        sp.project_id,
        TRUE AS hit
      FROM clock_ins ci
      JOIN staff_projects sp ON sp.staff_id = ci.staff_id AND sp.is_active = true
      JOIN zone_boundaries zb ON zb.project_id = sp.project_id AND zb.geom IS NOT NULL
      WHERE ST_Contains(zb.geom, ci.pt)
    ),
    per_staff_office_hits AS (
      SELECT DISTINCT ci.id AS clock_in_id, ci.staff_id
      FROM clock_ins ci
      JOIN fleet_authorized_locations fal
        ON fal.is_active = true
       AND fal.location_type = 'office'
       AND ST_DWithin(
             ST_SetSRID(ST_MakePoint(fal.lon::float8, fal.lat::float8), 4326)::geography,
             ci.pt::geography,
             COALESCE(fal.radius_km, 1.0) * 1000
           )
    ),
    per_staff_clock_in_first_match AS (
      SELECT
        ci.id AS clock_in_id,
        ci.staff_id,
        (
          SELECT psh.project_id
            FROM per_staff_polygon_hits psh
           WHERE psh.clock_in_id = ci.id
           LIMIT 1
        ) AS matched_project_id,
        EXISTS (SELECT 1 FROM per_staff_office_hits psoh WHERE psoh.clock_in_id = ci.id) AS hit_office
      FROM clock_ins ci
    ),
    per_project_counts AS (
      SELECT staff_id, matched_project_id, COUNT(*) AS hits
        FROM per_staff_clock_in_first_match
       WHERE matched_project_id IS NOT NULL
       GROUP BY staff_id, matched_project_id
    ),
    per_staff_aggregates AS (
      SELECT
        m.staff_id,
        COUNT(*)                                                    AS total_clock_ins,
        COUNT(*) FILTER (WHERE m.matched_project_id IS NOT NULL)    AS inside_any_assigned,
        COUNT(*) FILTER (WHERE m.hit_office)                        AS inside_office,
        COUNT(*) FILTER (
          WHERE m.matched_project_id IS NULL AND NOT m.hit_office
        )                                                            AS unmatched,
        COUNT(DISTINCT m.matched_project_id)
          FILTER (WHERE m.matched_project_id IS NOT NULL)            AS distinct_polygons_hit,
        COALESCE(
          (
            SELECT jsonb_object_agg(ppc.matched_project_id::text, ppc.hits)
              FROM per_project_counts ppc
             WHERE ppc.staff_id = m.staff_id
          ),
          '{}'::jsonb
        )                                                            AS per_project_hits_json
      FROM per_staff_clock_in_first_match m
      GROUP BY m.staff_id
    )
    SELECT
      s.id::text                                              AS staff_id,
      TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS full_name,
      s.department,
      s.home_site_id::text                                    AS home_site_id,
      (
        SELECT COUNT(*) FROM staff_projects sp
         WHERE sp.staff_id = s.id AND sp.is_active = true
      )::int                                                  AS active_assignment_count,
      COALESCE(psa.total_clock_ins, 0)::int                   AS total_clock_ins,
      COALESCE(psa.inside_any_assigned, 0)::int               AS inside_any_assigned,
      COALESCE(psa.inside_office, 0)::int                     AS inside_office,
      COALESCE(psa.unmatched, 0)::int                         AS unmatched,
      COALESCE(psa.distinct_polygons_hit, 0)::int             AS distinct_polygons_hit,
      COALESCE(psa.per_project_hits_json, '{}'::jsonb)        AS per_project_hits_json
    FROM staff s
    LEFT JOIN per_staff_aggregates psa ON psa.staff_id = s.id
    WHERE s.status = 'active'
      ${deptClause}
      ${staffScopeClause}
    ORDER BY full_name ASC
    LIMIT ${pb.next(REPORT_ROW_CAP + 1)}
  `;

  return { text, params: pb.params };
}

export async function runGeofencePatterns(input: ReportInput): Promise<ReportRunResult> {
  if (!input.dateFrom || !input.dateTo) {
    return { rows: [], columns: COLUMNS, notes: ['Date range is required.'] };
  }

  const { text, params } = buildGeofencePatternsSql({
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    departments: input.departments,
    scopedStaffIds: input.scopedStaffIds,
  });

  const rows = await sql.query<DbRow>(text, params);
  if (rows.length > REPORT_ROW_CAP) {
    throw new ReportTooLargeError(rows.length);
  }

  const enriched = rows.map((r) => {
    const total = r.total_clock_ins ?? 0;
    const pctInsideAnyAssignedPolygon = total > 0 ? (r.inside_any_assigned * 100) / total : 0;
    const pctInsideOffice = total > 0 ? (r.inside_office * 100) / total : 0;
    const pctUnmatched = total > 0 ? (r.unmatched * 100) / total : 0;

    const perProjectHits = parsePerProjectHits(r);
    const perProjectPct: Record<string, number> = {};
    let maxSingleProjectPct = 0;
    if (total > 0) {
      for (const [projectId, hits] of Object.entries(perProjectHits)) {
        const pct = (hits * 100) / total;
        perProjectPct[projectId] = pct;
        if (pct > maxSingleProjectPct) maxSingleProjectPct = pct;
      }
    }

    const metrics: ArchetypeMetrics = {
      totalClockIns: total,
      pctInsideAnyAssignedPolygon,
      pctInsideOffice,
      pctUnmatched,
      maxSingleProjectPct,
      distinctProjectPolygonsHit: r.distinct_polygons_hit,
      perProjectPct,
    };
    const { archetype: suggested, lowSignal } = suggestArchetype(metrics);
    const proposed: ArchetypeResolved = proposedDepartmentDefault(r.department);
    const mismatch = suggested !== proposed;
    const dataGapNoAssignments = suggested === 'project' && r.active_assignment_count === 0;
    const dataGapNoHomeSite = suggested === 'office' && r.home_site_id === null;

    return {
      staff: r.full_name,
      department: r.department ?? '',
      total_clock_ins: total,
      pct_inside_any_assigned: roundPct(pctInsideAnyAssignedPolygon),
      pct_inside_office: roundPct(pctInsideOffice),
      pct_unmatched: roundPct(pctUnmatched),
      distinct_polygons_hit: r.distinct_polygons_hit,
      max_single_project_pct: roundPct(maxSingleProjectPct),
      suggested_archetype: suggested,
      proposed_default_archetype: proposed,
      mismatch: mismatch ? 'yes' : 'no',
      low_signal: lowSignal ? 'yes' : 'no',
      data_gap_no_assignments: dataGapNoAssignments ? 'yes' : 'no',
      data_gap_no_home_site: dataGapNoHomeSite ? 'yes' : 'no',
    };
  });

  return { rows: enriched, columns: COLUMNS, notes: [] };
}

function roundPct(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Read per_project_hits_json as a {project_id: hits} record. The pg driver
 * may auto-parse JSONB to an object or return it as a string depending on
 * pool config — handle both, and don't let one malformed row poison the
 * whole report.
 */
function parsePerProjectHits(r: DbRow): Record<string, number> {
  const v = r.per_project_hits_json;
  if (v == null) return {};
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, number>;
    } catch {
      log.warn(
        '[geofencePatterns] per_project_hits_json parse failed; treating as empty',
        { staff_id: r.staff_id, raw: v.slice(0, 200) },
        'GeofencePatterns',
      );
      return {};
    }
  }
  return v;
}
