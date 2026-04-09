/**
 * Snags By Status API
 * GET /api/snags/by-status?projectId=X&status=pending_qa
 *
 * Returns snags for a project filtered by effective status (respects NOC ticket override),
 * used by the summary page drill-down accordion.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

const STATUS_SQL_MAP: Record<string, { ticketStatuses: string[]; snagStatuses: string[] }> = {
  open:        { ticketStatuses: ['open'],                                                         snagStatuses: ['open', 'reopened'] },
  assigned:    { ticketStatuses: ['assigned'],                                                     snagStatuses: ['assigned'] },
  in_progress: { ticketStatuses: ['in_progress', 'qa_rejected'],                                   snagStatuses: ['in_progress'] },
  pending_qa:  { ticketStatuses: ['pending_qa', 'qa_in_progress'],                                 snagStatuses: ['pending_qa', 'fixed'] },
  resolved:    { ticketStatuses: ['qa_approved', 'pending_handover', 'handed_to_ops', 'resolved'], snagStatuses: ['resolved'] },
  verified:    { ticketStatuses: ['verified'],                                                     snagStatuses: ['verified'] },
  closed:      { ticketStatuses: ['closed', 'cancelled'],                                          snagStatuses: ['closed'] },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET']);
  }

  const { projectId, status } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.error(res, 400 as never, 'projectId is required');
  }
  if (!status || typeof status !== 'string' || !STATUS_SQL_MAP[status]) {
    return apiResponse.error(res, 400 as never, `Invalid status. Must be one of: ${Object.keys(STATUS_SQL_MAP).join(', ')}`);
  }

  try {
    const mapping = STATUS_SQL_MAP[status];

    const rows = await sql`
      SELECT
        s.id, s.snag_number, s.description, s.severity, s.status, s.category,
        s.pole_references, s.noc_ticket_id, s.created_at,
        (u.first_name || ' ' || u.last_name) AS assigned_to_name,
        mt.ticket_uid AS noc_ticket_uid,
        COALESCE(pole.zone_no, dr.zone_no) AS zone_no,
        COALESCE(pole.pon_no, dr.pon_no) AS pon_no
      FROM snags s
      LEFT JOIN users u ON u.id = s.assigned_to
      LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.project_id = ${projectId}
        AND (
          (mt.id IS NOT NULL AND mt.status = ANY(${mapping.ticketStatuses}))
          OR
          (mt.id IS NULL AND s.status = ANY(${mapping.snagStatuses}))
        )
      ORDER BY COALESCE(pole.zone_no, dr.zone_no) ASC NULLS LAST,
               COALESCE(pole.pon_no, dr.pon_no) ASC NULLS LAST,
               s.snag_number ASC
    `;

    return apiResponse.success(res, rows);
  } catch (error) {
    log.error('Snags by-status API error', { error, projectId, status });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
