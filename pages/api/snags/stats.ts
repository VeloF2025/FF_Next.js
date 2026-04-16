/**
 * Snags Stats API
 * GET /api/snags/stats
 *
 * Optional query filters (all multi-select via repeated params or CSV):
 *   projectIds      — comma-separated project UUIDs
 *   severity        — comma-separated: major,minor,critical
 *   reportType      — comma-separated: tqr,field_report
 *   importFrom      — ISO date (inclusive) for snag_reports.created_at
 *   importTo        — ISO date (inclusive) for snag_reports.created_at
 *
 * Filters at the snag level by joining on snag_reports and applying
 * WHERE conditions. Returns one row per project that has matching snags.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { SnagProjectStats } from '@/modules/construction-qa/types/snag.types';

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
    const projectIds = parseList(req.query.projectIds);
    const severity   = parseList(req.query.severity);
    const reportType = parseList(req.query.reportType);
    const importFrom = parseDate(req.query.importFrom);
    const importTo   = parseDate(req.query.importTo);

    const rows = await sql`
      SELECT
        p.id             AS project_id,
        p.project_name   AS project_name,
        COUNT(s.id)      AS total,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status = 'open'
               ELSE s.status IN ('open','reopened') END
        ) AS open,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status = 'assigned'
               ELSE s.status = 'assigned' END
        ) AS assigned,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('in_progress','qa_rejected')
               ELSE s.status = 'in_progress' END
        ) AS in_progress,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('pending_qa','qa_in_progress')
               ELSE s.status IN ('pending_qa','fixed') END
        ) AS pending_qa,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('qa_approved','pending_handover','handed_to_ops','resolved')
               ELSE s.status = 'resolved' END
        ) AS resolved,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status = 'verified'
               ELSE s.status = 'verified' END
        ) AS verified,
        COUNT(s.id) FILTER (WHERE
          CASE WHEN t.id IS NOT NULL THEN t.status IN ('closed','cancelled')
               ELSE s.status = 'closed' END
        ) AS closed,
        lr.report_number AS latest_report_number,
        lr.audit_date    AS latest_report_date,
        lr.id            AS latest_report_id
      FROM projects p
      INNER JOIN snags s ON s.project_id = p.id
      INNER JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN maintenance_tickets t ON t.id = s.noc_ticket_id
      LEFT JOIN LATERAL (
        SELECT id, report_number, audit_date
        FROM snag_reports r
        WHERE r.project_id = p.id
        ORDER BY r.audit_date DESC
        LIMIT 1
      ) lr ON TRUE
      WHERE
        (${projectIds}::uuid[] IS NULL OR p.id = ANY(${projectIds}::uuid[]))
        AND (${severity}::text[] IS NULL OR s.severity = ANY(${severity}::text[]))
        AND (${importFrom}::date IS NULL OR sr.created_at >= ${importFrom}::date)
        AND (${importTo}::date IS NULL OR sr.created_at < (${importTo}::date + INTERVAL '1 day'))
        AND (${reportType}::text[] IS NULL OR (
          ('tqr' = ANY(${reportType}::text[]) AND sr.report_number NOT LIKE 'FIELD-%')
          OR ('field_report' = ANY(${reportType}::text[]) AND sr.report_number LIKE 'FIELD-%')
        ))
      GROUP BY p.id, p.project_name, lr.report_number, lr.audit_date, lr.id
      ORDER BY p.project_name ASC
    ` as Array<{
      project_id: string;
      project_name: string;
      total: string;
      open: string;
      assigned: string;
      in_progress: string;
      pending_qa: string;
      resolved: string;
      verified: string;
      closed: string;
      latest_report_number: string | null;
      latest_report_date: string | null;
      latest_report_id: string | null;
    }>;

    const stats: SnagProjectStats[] = rows.map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      total: parseInt(r.total, 10),
      open: parseInt(r.open, 10),
      assigned: parseInt(r.assigned, 10),
      in_progress: parseInt(r.in_progress, 10),
      pending_qa: parseInt(r.pending_qa, 10),
      resolved: parseInt(r.resolved, 10),
      verified: parseInt(r.verified, 10),
      closed: parseInt(r.closed, 10),
      latest_report_number: r.latest_report_number,
      latest_report_date: r.latest_report_date,
      latest_report_id: r.latest_report_id,
    }));

    return apiResponse.success(res, stats);
  } catch (error) {
    log.error('Snags stats API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
