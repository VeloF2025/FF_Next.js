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

  // Location columns are resolved across three sources so the query covers
  // BOTH Works QA snags (linked via pole_qa_photo_id → pole_qa_photos) AND
  // TQR-imported snags (linked via pole_ids[1] → poles, or drop_id → drops).
  // Mirrors the join pattern used by /api/snags/zone-pon-options so the
  // chip picker and the scope query see the same set of zones/PONs.
  //
  // INVARIANT: a snag is either Works QA-originated (pole_qa_photo_id IS NOT
  // NULL, source='works_qa') or TQR-imported (pole_qa_photo_id IS NULL,
  // source IS NULL) — never both. The COALESCE precedence
  // (pole_qa_photos → poles → drops) is therefore unambiguous in practice;
  // each snag's zone/PON resolves from exactly one source.
  return (await sql`
    SELECT
      s.id,
      s.snag_number,
      s.category,
      s.severity,
      s.status,
      s.description,
      COALESCE(pqa.zone_no, pl.zone_no, dr.zone_no)                AS zone_no,
      COALESCE(pqa.pon_no,  pl.pon_no,  dr.pon_no)                 AS pon_no,
      COALESCE(pqa.pole_label, pl.pole_number, dr.pole_number,
               s.pole_references[1])                               AS pole_number,
      s.pole_qa_photo_id,
      s.slot_key,
      s.created_at::text         AS created_at,
      mt.ticket_uid              AS noc_ticket_uid
    FROM   snags s
    LEFT   JOIN pole_qa_photos      pqa ON pqa.id = s.pole_qa_photo_id
    LEFT   JOIN poles               pl  ON pl.id  = s.pole_ids[1]
    LEFT   JOIN drops               dr  ON dr.id  = s.drop_id
    LEFT   JOIN maintenance_tickets mt  ON mt.id  = s.noc_ticket_id
    WHERE  s.project_id = ${project_id}
      AND  (${zones}::int[]   IS NULL
             OR COALESCE(pqa.zone_no, pl.zone_no, dr.zone_no) = ANY(${zones}::int[]))
      AND  (${pons}::int[]    IS NULL
             OR COALESCE(pqa.pon_no,  pl.pon_no,  dr.pon_no)  = ANY(${pons}::int[]))
      AND  (${poles}::text[]  IS NULL
             OR COALESCE(pqa.pole_label, pl.pole_number, dr.pole_number,
                         s.pole_references[1])                = ANY(${poles}::text[]))
      AND  s.created_at >= ${from_date}::date
      AND  s.created_at <  (${to_date}::date + INTERVAL '1 day')
      AND  s.severity = ANY(${severities}::text[])
      AND  (${categories}::text[] IS NULL OR s.category = ANY(${categories}::text[]))
    ORDER  BY
      COALESCE(pqa.zone_no, pl.zone_no, dr.zone_no)                NULLS LAST,
      COALESCE(pqa.pon_no,  pl.pon_no,  dr.pon_no)                 NULLS LAST,
      COALESCE(pqa.pole_label, pl.pole_number, dr.pole_number,
               s.pole_references[1])                               NULLS LAST,
      s.created_at
  `) as unknown as SnagReportScopeRow[];
}
