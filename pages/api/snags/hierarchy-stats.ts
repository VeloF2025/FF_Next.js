/**
 * Snags Hierarchy Stats API
 * GET /api/snags/hierarchy-stats
 *
 * Optional query filters:
 *   projectId       — single project UUID (back-compat)
 *   projectIds      — comma-separated project UUIDs (takes precedence)
 *   search          — text search in description, pole refs, pole/drop numbers
 *   severity        — comma-separated: major,minor,critical
 *   reportType      — comma-separated: tqr,field_report
 *   importFrom      — ISO date (inclusive) for snag_reports.created_at
 *   importTo        — ISO date (inclusive) for snag_reports.created_at
 *
 * Returns snag counts grouped by project -> zone -> PON with filters
 * applied at the snag level (via join on snag_reports).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { HierarchyRow } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

function parseList(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

function parseDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const d = raw.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  try {
    // Support legacy ?projectId=X alongside new ?projectIds=X,Y
    const legacyProjectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
    const projectIds      = parseList(req.query.projectIds) ?? (legacyProjectId ? [legacyProjectId] : null);
    const severity        = parseList(req.query.severity);
    const reportType      = parseList(req.query.reportType);
    const importFrom      = parseDate(req.query.importFrom);
    const importTo        = parseDate(req.query.importTo);

    const searchTerm      = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const searchPattern   = searchTerm ? `%${searchTerm}%` : null;

    const rows = await sql`
      SELECT
        p.id AS project_id, p.project_name,
        COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
        COALESCE(pole.pon_no, dr.pon_no) AS pon_no,
        COUNT(s.id) AS total,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'open' ELSE s.status IN ('open','reopened') END) AS open,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned' ELSE s.status = 'assigned' END) AS assigned,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected') ELSE s.status = 'in_progress' END) AS in_progress,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress') ELSE s.status IN ('pending_qa','fixed') END) AS pending_qa,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved') ELSE s.status = 'resolved' END) AS resolved,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status = 'verified' ELSE s.status = 'verified' END) AS verified,
        COUNT(s.id) FILTER (WHERE CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled') ELSE s.status = 'closed' END) AS closed
      FROM projects p
      INNER JOIN snags s ON s.project_id = p.id
      INNER JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE
        (${projectIds}::uuid[] IS NULL OR p.id = ANY(${projectIds}::uuid[]))
        AND (${severity}::text[] IS NULL OR s.severity = ANY(${severity}::text[]))
        AND (${importFrom}::date IS NULL OR sr.created_at >= ${importFrom}::date)
        AND (${importTo}::date IS NULL OR sr.created_at < (${importTo}::date + INTERVAL '1 day'))
        AND (${reportType}::text[] IS NULL OR (
          ('tqr' = ANY(${reportType}::text[]) AND sr.report_number NOT LIKE 'FIELD-%')
          OR ('field_report' = ANY(${reportType}::text[]) AND sr.report_number LIKE 'FIELD-%')
        ))
        AND (${searchPattern}::text IS NULL OR (
          s.description ILIKE ${searchPattern}
          OR EXISTS (SELECT 1 FROM unnest(s.pole_references) ref WHERE ref ILIKE ${searchPattern})
          OR pole.pole_number ILIKE ${searchPattern}
          OR dr.drop_number ILIKE ${searchPattern}
        ))
      GROUP BY p.id, p.project_name, COALESCE(pole.zone_no, dr.zone_no), COALESCE(pole.pon_no, dr.pon_no)
      ORDER BY p.project_name ASC, COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST, COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST
    ` as Array<{
      project_id: string;
      project_name: string;
      zone_no: string | null;
      pon_no: string | null;
      total: string;
      open: string;
      assigned: string;
      in_progress: string;
      pending_qa: string;
      resolved: string;
      verified: string;
      closed: string;
    }>;

    const data: HierarchyRow[] = rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      zone_no: r.zone_no !== null ? Number(r.zone_no) : null,
      pon_no: r.pon_no !== null ? Number(r.pon_no) : null,
      total: parseInt(r.total, 10),
      open: parseInt(r.open, 10),
      assigned: parseInt(r.assigned, 10),
      in_progress: parseInt(r.in_progress, 10),
      pending_qa: parseInt(r.pending_qa, 10),
      resolved: parseInt(r.resolved, 10),
      verified: parseInt(r.verified, 10),
      closed: parseInt(r.closed, 10),
    }));

    return apiResponse.success(res, data);
  } catch (error) {
    log.error('Snags hierarchy-stats API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
