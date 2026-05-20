/**
 * GET /api/snags/reports-scope-xlsx?id=<uuid>
 *
 * On-demand xlsx regeneration for a previously stored scope snag report.
 * Re-runs the same scope query the POST route uses and builds a 3-sheet
 * workbook (Summary / Snags / Scope) via buildScopeSnagWorkbook.
 *
 * Permission: construction-qa.snags.reports
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { sql } from '@/lib/db-pool';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { buildScopeSnagWorkbook } from '@/modules/construction-qa/services/snagReportXlsx';
import type {
  SnagReportMeta,
  SnagReportScopeRow,
} from '@/modules/construction-qa/services/snagReportRenderer';

// ── Internal types ────────────────────────────────────────────────────────────

interface ScopeReportRow {
  id: string;
  project_id: string;
  project_name: string;
  report_number: string;
  scope: 'pole' | 'pon' | 'zone';
  scope_zone_no: number | null;
  scope_pon_no: number | null;
  scope_poles: string[] | null;
  scope_from_date: string;
  scope_to_date: string;
  scope_severities: string[] | null;
  scope_categories: string[] | null;
  generated_by: string | null;
  generated_at: Date;
}

// ── Handler ───────────────────────────────────────────────────────────────────

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const id = req.query.id;
  if (typeof id !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'id query parameter is required');
  }

  // ── Fetch report metadata ─────────────────────────────────────────────────

  const reportRows = (await sql`
    SELECT sr.id,
           sr.project_id,
           p.project_name,
           sr.report_number,
           sr.scope,
           sr.scope_zone_no,
           sr.scope_pon_no,
           sr.scope_poles,
           sr.scope_from_date::text AS scope_from_date,
           sr.scope_to_date::text   AS scope_to_date,
           sr.scope_severities,
           sr.scope_categories,
           sr.generated_by::text    AS generated_by,
           sr.generated_at
    FROM   snag_reports sr
    INNER  JOIN projects p ON p.id = sr.project_id
    WHERE  sr.id = ${id}
      AND  sr.source = 'scope'
  ` as unknown) as ScopeReportRow[];

  if (reportRows.length === 0) {
    return apiResponse.notFound(res, 'Scope report', id);
  }

  const r = reportRows[0]!;

  // ── Rebuild scope arrays ──────────────────────────────────────────────────

  const zones = r.scope_zone_no !== null ? [r.scope_zone_no] : [];
  const pons  = r.scope_pon_no  !== null ? [r.scope_pon_no]  : [];
  const poles = r.scope_poles   ?? [];

  const meta: SnagReportMeta = {
    reportNumber: r.report_number,
    projectName:  r.project_name,
    scope:        r.scope,
    zones, pons, poles,
    fromDate:     r.scope_from_date,
    toDate:       r.scope_to_date,
    severities:   r.scope_severities ?? [],
    categories:   r.scope_categories ?? [],
    generatedAt:  r.generated_at.toISOString(),
    generatedBy:  r.generated_by ?? 'system',
  };

  // SQL arrays — null means "no filter" (all values match).
  const zonesArr      = zones.length ? zones : null;
  const ponsArr       = pons.length  ? pons  : null;
  const polesArr      = poles.length ? poles : null;
  const severitiesArr = r.scope_severities ?? [];
  const categoriesArr = r.scope_categories;

  // ── Re-run scope query (same filter as POST route) ────────────────────────
  // pole_label aliased as pole_number; maintenance_tickets aliased noc_ticket_uid
  // per DB-verified schema (no pole_number column, no noc_tickets table).

  const rows = (await sql`
    SELECT s.id,
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
           nt.ticket_uid              AS noc_ticket_uid
    FROM   snags s
    LEFT   JOIN pole_qa_photos      p  ON p.id  = s.pole_qa_photo_id
    LEFT   JOIN maintenance_tickets nt ON nt.id = s.noc_ticket_id
    WHERE  s.project_id = ${r.project_id}
      AND  (${zonesArr}::int[]   IS NULL OR p.zone_no    = ANY(${zonesArr}::int[]))
      AND  (${ponsArr}::int[]    IS NULL OR p.pon_no     = ANY(${ponsArr}::int[]))
      AND  (${polesArr}::text[]  IS NULL OR p.pole_label = ANY(${polesArr}::text[]))
      AND  s.created_at >= ${r.scope_from_date}::date
      AND  s.created_at <  (${r.scope_to_date}::date + INTERVAL '1 day')
      AND  s.severity = ANY(${severitiesArr}::text[])
      AND  (${categoriesArr}::text[] IS NULL OR s.category = ANY(${categoriesArr}::text[]))
    ORDER  BY p.zone_no NULLS LAST,
              p.pon_no  NULLS LAST,
              p.pole_label NULLS LAST,
              s.created_at
  ` as unknown) as SnagReportScopeRow[];

  // ── Build workbook and stream ─────────────────────────────────────────────

  const wb  = buildScopeSnagWorkbook(meta, rows);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${r.report_number}.xlsx"`,
  );
  res.status(200).end(buf);
}

export default withAuth(
  withPermission('construction-qa.snags.reports', 'view')(handler),
);
