/**
 * Snags API
 * GET   /api/snags — List snags with filters
 * POST  /api/snags — Create a snag
 * PATCH /api/snags — Update a snag (status, assignment, verification)
 *
 * Query helpers (explicit SQL branches) live in snags-query.ts.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { querySnagsByReport, querySnagsByProject } from './snags-query';
import { updateTicket } from '@/modules/noc/services/ticketService';
import { TicketStatus } from '@/modules/noc/types/ticket';
import type {
  Snag,
  SnagStatus,
  CreateSnagRequest,
  UpdateSnagRequest,
} from '@/modules/construction-qa/types/snag.types';

/** Map snag status → NOC ticket status for sync (returns undefined if no sync needed) */
function mapSnagStatusToTicketStatus(snagStatus: SnagStatus): TicketStatus | undefined {
  switch (snagStatus) {
    case 'fixed':    return TicketStatus.RESOLVED;
    case 'verified': return TicketStatus.RESOLVED;
    case 'closed':   return TicketStatus.CLOSED;
    default:         return undefined;
  }
}

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return await handleGet(req, res);
      case 'POST':
        return await handlePost(req, res);
      case 'PATCH':
        return await handlePatch(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['GET', 'POST', 'PATCH']);
    }
  } catch (error) {
    log.error('Snags API error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const {
    reportId,
    projectId,
    status,
    category,
    severity,
    search,
    page = '1',
    pageSize = '50',
  } = req.query;

  const pageNum = Math.max(1, parseInt(page as string, 10));
  const pageSizeNum = Math.min(200, parseInt(pageSize as string, 10));
  const offset = (pageNum - 1) * pageSizeNum;
  const searchTerm = search && typeof search === 'string' ? `%${search}%` : null;

  if (reportId && typeof reportId === 'string') {
    return querySnagsByReport(
      res, reportId,
      status as string | undefined,
      category as string | undefined,
      severity as string | undefined,
      searchTerm,
      pageNum, pageSizeNum, offset
    );
  }

  if (projectId && typeof projectId === 'string') {
    return querySnagsByProject(
      res, projectId,
      status as string | undefined,
      category as string | undefined,
      severity as string | undefined,
      pageNum, pageSizeNum, offset
    );
  }

  // No filter — all snags paginated
  const rows = await sql`
    SELECT s.*, (u.first_name || ' ' || u.last_name) AS assigned_to_name, sr.report_number, sr.audit_date, mt.ticket_uid AS noc_ticket_uid
    FROM snags s
    LEFT JOIN users u ON u.id = s.assigned_to
    LEFT JOIN snag_reports sr ON sr.id = s.report_id
    LEFT JOIN maintenance_tickets mt ON mt.id = s.noc_ticket_id
    ORDER BY s.created_at DESC
    LIMIT ${pageSizeNum} OFFSET ${offset}
  ` as Snag[];

  const countRows = await sql`SELECT COUNT(*) AS total FROM snags` as Array<{ total: string }>;
  const total = parseInt(countRows[0]?.total ?? '0', 10);

  return apiResponse.paginated(res, rows, { page: pageNum, pageSize: pageSizeNum, total });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as CreateSnagRequest;

  if (!body.report_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'report_id is required');
  }
  if (!body.project_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'project_id is required');
  }
  if (!body.snag_number) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_number is required');
  }
  if (!body.category) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'category is required');
  }
  if (!body.description || !body.description.trim()) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'description is required');
  }

  const rows = await sql`
    INSERT INTO snags (
      report_id, project_id, snag_number,
      category, severity, description,
      pole_references, status
    ) VALUES (
      ${body.report_id},
      ${body.project_id},
      ${body.snag_number},
      ${body.category},
      ${body.severity ?? 'major'},
      ${body.description.trim()},
      ${body.pole_references ?? null},
      'open'
    )
    RETURNING *
  ` as Snag[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create snag');
  }

  // Update total_findings count on report
  await sql`
    UPDATE snag_reports
    SET total_findings = (
      SELECT COUNT(*) FROM snags WHERE report_id = ${body.report_id}
    ),
    updated_at = NOW()
    WHERE id = ${body.report_id}
  `;

  log.info('Snag created', { snagId: rows[0].id, reportId: body.report_id });
  return apiResponse.created(res, rows[0]);
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as UpdateSnagRequest;

  if (!body.id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'id is required');
  }

  const existing = await sql`
    SELECT id, status FROM snags WHERE id = ${body.id}
  ` as Array<{ id: string; status: string }>;

  if (existing.length === 0) {
    return apiResponse.notFound(res, 'Snag', body.id);
  }

  // Derive timestamp fields from status transition
  const fixedAt     = body.status === 'fixed'    ? new Date().toISOString() : null;
  const verifiedAt  = body.status === 'verified' ? new Date().toISOString() : null;
  const closedAt    = body.status === 'closed'   ? new Date().toISOString() : null;
  const assignedAt  = body.assigned_to           ? new Date().toISOString() : null;

  const rows = await sql`
    UPDATE snags
    SET
      status             = COALESCE(${body.status ?? null}, status),
      assigned_to        = CASE WHEN ${body.assigned_to !== undefined} THEN ${body.assigned_to ?? null} ELSE assigned_to END,
      assigned_at        = CASE WHEN ${body.assigned_to !== undefined} THEN ${assignedAt} ELSE assigned_at END,
      severity           = COALESCE(${body.severity ?? null}, severity),
      fix_deadline       = CASE WHEN ${body.fix_deadline !== undefined} THEN ${body.fix_deadline ?? null} ELSE fix_deadline END,
      verification_notes = COALESCE(${body.verification_notes ?? null}, verification_notes),
      noc_ticket_id      = CASE WHEN ${body.noc_ticket_id !== undefined} THEN ${body.noc_ticket_id ?? null} ELSE noc_ticket_id END,
      fixed_at           = COALESCE(${fixedAt}, fixed_at),
      verified_at        = COALESCE(${verifiedAt}, verified_at),
      closed_at          = COALESCE(${closedAt}, closed_at),
      updated_at         = NOW()
    WHERE id = ${body.id}
    RETURNING *
  ` as Snag[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to update snag');
  }

  const updatedSnag = rows[0];

  // Sync status to linked NOC ticket if applicable
  if (body.status && updatedSnag.noc_ticket_id) {
    const ticketStatus = mapSnagStatusToTicketStatus(body.status);
    if (ticketStatus) {
      try {
        await updateTicket(updatedSnag.noc_ticket_id, { status: ticketStatus });
        log.info('NOC ticket status synced', {
          snagId: body.id,
          ticketId: updatedSnag.noc_ticket_id,
          ticketStatus,
        });
      } catch (syncErr) {
        // Non-fatal: log but don't fail the snag update
        log.error('Failed to sync NOC ticket status', {
          snagId: body.id,
          ticketId: updatedSnag.noc_ticket_id,
          syncErr,
        });
      }
    }
  }

  log.info('Snag updated', { snagId: body.id, status: body.status });
  return apiResponse.success(res, updatedSnag);
}

export default withAuth(handler);
