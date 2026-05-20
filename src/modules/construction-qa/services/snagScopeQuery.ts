/**
 * snagScopeQuery — shared scope-filter SQL for scoped snag reports.
 *
 * Both POST /api/snags/reports-scope (PDF generator) and
 * GET /api/snags/reports-scope-xlsx (xlsx regen) run identical WHERE clauses.
 * Centralising here prevents drift between the two routes.
 */

import { sql } from '@/lib/db-pool';
import type { SnagReportScopeRow } from './snagReportRenderer';

export interface ScopeQueryParams {
  project_id: string;
  zones: number[] | null;   // NULL → no zone filter
  pons:  number[] | null;   // NULL → no PON filter
  poles: string[] | null;   // NULL → no pole filter
  from_date: string;        // ISO YYYY-MM-DD inclusive
  to_date:   string;        // ISO YYYY-MM-DD inclusive
  severities: string[];
  categories: string[] | null; // NULL → all categories
}

/**
 * Runs the canonical scope-filter query and returns the matching snag rows
 * ordered by zone → PON → pole → created_at.
 */
export async function runSnagScopeQuery(
  params: ScopeQueryParams,
): Promise<SnagReportScopeRow[]> {
  const { project_id, zones, pons, poles, from_date, to_date, severities, categories } = params;

  return (await sql`
    SELECT
      s.id,
      s.snag_number,
      s.category,
      s.severity,
      s.status,
      s.description,
      p.zone_no,
      p.pon_no,
      p.pole_label               AS pole_number,
      s.pole_qa_photo_id,
      s.slot_key,
      s.created_at::text         AS created_at,
      mt.ticket_uid              AS noc_ticket_uid
    FROM   snags s
    LEFT   JOIN pole_qa_photos      p  ON p.id  = s.pole_qa_photo_id
    LEFT   JOIN maintenance_tickets mt ON mt.id  = s.noc_ticket_id
    WHERE  s.project_id = ${project_id}
      AND  (${zones}::int[]   IS NULL OR p.zone_no    = ANY(${zones}::int[]))
      AND  (${pons}::int[]    IS NULL OR p.pon_no     = ANY(${pons}::int[]))
      AND  (${poles}::text[]  IS NULL OR p.pole_label = ANY(${poles}::text[]))
      AND  s.created_at >= ${from_date}::date
      AND  s.created_at <  (${to_date}::date + INTERVAL '1 day')
      AND  s.severity = ANY(${severities}::text[])
      AND  (${categories}::text[] IS NULL OR s.category = ANY(${categories}::text[]))
    ORDER  BY
      p.zone_no    NULLS LAST,
      p.pon_no     NULLS LAST,
      p.pole_label NULLS LAST,
      s.created_at
  `) as unknown as SnagReportScopeRow[];
}
