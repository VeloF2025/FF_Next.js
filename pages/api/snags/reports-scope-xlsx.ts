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
import { runSnagScopeQuery } from '@/modules/construction-qa/services/snagScopeQuery';
import type { SnagReportMeta } from '@/modules/construction-qa/services/snagReportRenderer';

// ── Internal types ────────────────────────────────────────────────────────────

interface ScopeReportRow {
  id: string;
  project_id: string;
  project_name: string;
  report_number: string;
  scope: 'pole' | 'pon' | 'zone';
  scope_zone_nos: number[] | null;
  scope_pon_nos: number[] | null;
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
           sr.scope_zone_nos,
           sr.scope_pon_nos,
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

  // ── Rebuild scope arrays from stored INT[] columns ────────────────────────

  const zones = r.scope_zone_nos ?? [];
  const pons  = r.scope_pon_nos  ?? [];
  const poles = r.scope_poles    ?? [];

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

  // ── Re-run scope query (same filter as POST route via shared helper) ───────

  const rows = await runSnagScopeQuery({
    project_id:  r.project_id,
    zones:       zones.length ? zones : null,
    pons:        pons.length  ? pons  : null,
    poles:       poles.length ? poles : null,
    from_date:   r.scope_from_date,
    to_date:     r.scope_to_date,
    severities:  r.scope_severities ?? [],
    categories:  r.scope_categories,
  });

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
