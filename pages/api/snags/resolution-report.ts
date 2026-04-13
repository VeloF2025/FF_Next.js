/**
 * Snag Resolution Report API
 *
 * GET /api/snags/resolution-report
 *
 * Returns snags resolved/fixed within a date range, with full context
 * (project, zone, pon, report, pole, assignee, open date, resolved date).
 *
 * Query params:
 *   date_from    — ISO date string (required) — filters by audit_date >= date_from
 *   date_to      — ISO date string (required) — filters by fixed_at <= date_to OR updated_at when resolved
 *   project_id   — UUID (optional)
 *   status       — comma-separated statuses (optional, default: pending_qa,resolved,verified,closed)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

export interface ResolutionReportRow {
  id: string;
  project_id: string;
  project_name: string;
  report_number: string;
  audit_date: string;
  description: string;
  pole_reference: string | null;
  zone_no: number | null;
  pon_no: number | null;
  category: string;
  severity: string;
  status: string;
  snag_number: number;
  opened_date: string;          // audit_date from report
  resolved_date: string | null; // fixed_at or updated_at
  assigned_to_name: string | null;
  noc_ticket_uid: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const { date_from, date_to, project_id } = req.query;

  if (!date_from || typeof date_from !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'date_from is required');
  }
  if (!date_to || typeof date_to !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'date_to is required');
  }

  // Normalise: date_to should be end-of-day
  const dateFrom = new Date(date_from);
  const dateTo = new Date(date_to);
  dateTo.setHours(23, 59, 59, 999);

  if (isNaN(dateFrom.getTime()) || isNaN(dateTo.getTime())) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid date format');
  }

  try {
    log.info('ResolutionReport: querying', { date_from, date_to, project_id });

    if (project_id && typeof project_id === 'string') {
      const rows = await sql`
        SELECT
          s.id,
          s.project_id,
          p.project_name,
          sr.report_number,
          sr.audit_date,
          s.description,
          s.pole_references[1]                                   AS pole_reference,
          COALESCE(pole.zone_no, dr.zone_no, zb.zone_no)         AS zone_no,
          COALESCE(pole.pon_no,  dr.pon_no,  pb.pon_no)          AS pon_no,
          s.category,
          s.severity,
          s.status,
          s.snag_number,
          sr.audit_date                                          AS opened_date,
          COALESCE(s.fixed_at, s.updated_at)                     AS resolved_date,
          (u.first_name || ' ' || u.last_name)                   AS assigned_to_name,
          mt.ticket_uid                                          AS noc_ticket_uid
        FROM snags s
        LEFT JOIN projects p     ON p.id = s.project_id
        LEFT JOIN snag_reports sr ON sr.id = s.report_id
        LEFT JOIN users u         ON u.id = s.assigned_to
        LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
        LEFT JOIN poles pole      ON pole.id = s.pole_ids[1]
        LEFT JOIN drops dr        ON dr.id = s.drop_id
        LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
        LEFT JOIN pon_boundaries pb  ON pb.id = s.pon_id
        WHERE s.project_id = ${project_id}
          AND s.status IN ('pending_qa', 'resolved', 'verified', 'closed')
          AND sr.audit_date >= ${dateFrom.toISOString().slice(0, 10)}
          AND sr.audit_date <= ${dateTo.toISOString().slice(0, 10)}
        ORDER BY sr.audit_date ASC, s.snag_number ASC
      ` as ResolutionReportRow[];

      log.info('ResolutionReport: done', { count: rows.length, project_id });
      return apiResponse.success(res, { rows, date_from, date_to });
    }

    // All projects
    const rows = await sql`
      SELECT
        s.id,
        s.project_id,
        p.project_name,
        sr.report_number,
        sr.audit_date,
        s.description,
        s.pole_references[1]                                   AS pole_reference,
        COALESCE(pole.zone_no, dr.zone_no, zb.zone_no)         AS zone_no,
        COALESCE(pole.pon_no,  dr.pon_no,  pb.pon_no)          AS pon_no,
        s.category,
        s.severity,
        s.status,
        s.snag_number,
        sr.audit_date                                          AS opened_date,
        COALESCE(s.fixed_at, s.updated_at)                     AS resolved_date,
        (u.first_name || ' ' || u.last_name)                   AS assigned_to_name,
        mt.ticket_uid                                          AS noc_ticket_uid
      FROM snags s
      LEFT JOIN projects p     ON p.id = s.project_id
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN users u         ON u.id = s.assigned_to
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole      ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr        ON dr.id = s.drop_id
      LEFT JOIN zone_boundaries zb ON zb.id = s.zone_id
      LEFT JOIN pon_boundaries pb  ON pb.id = s.pon_id
      WHERE s.status IN ('pending_qa', 'resolved', 'verified', 'closed')
        AND sr.audit_date >= ${dateFrom.toISOString().slice(0, 10)}
        AND sr.audit_date <= ${dateTo.toISOString().slice(0, 10)}
      ORDER BY p.project_name ASC, sr.audit_date ASC, s.snag_number ASC
    ` as ResolutionReportRow[];

    log.info('ResolutionReport: done', { count: rows.length });
    return apiResponse.success(res, { rows, date_from, date_to });

  } catch (error) {
    log.error('ResolutionReport: failed', { error });
    return apiResponse.internalError(res, error, 'Resolution report failed');
  }
}

export default withAuth(handler);
