/**
 * POST /api/snags/create-ticket
 *
 * Creates a NOC ticket from a snag and links them bidirectionally.
 * Body: { snag_id: string }
 *
 * Flow:
 * 1. Fetch snag + report data
 * 2. Build CreateTicketPayload from snag fields
 * 3. Call createTicket() from ticketService
 * 4. Update snag: noc_ticket_id + status = 'assigned'
 * 5. Return { ticket, snag }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, getAuthUser } from '@/lib/auth';
import { createTicket } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/noc/types/ticket';
import type { Snag, SnagCategory, SnagSeverity } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Mapping helpers
// ============================================================

/** Map snag category → NOC ticket type */
function mapCategoryToTicketType(category: SnagCategory): TicketType {
  switch (category) {
    case 'safety':
      return TicketType.FAULT_REPAIR;
    case 'quality':
      return TicketType.FAULT_REPAIR;
    case 'health':
      return TicketType.FAULT_REPAIR;
    case 'environment':
      return TicketType.FAULT_REPAIR;
    case 'traffic':
      return TicketType.FAULT_REPAIR;
    default:
      return TicketType.FAULT_REPAIR;
  }
}

/** Map snag severity → ticket priority */
function mapSeverityToPriority(severity: SnagSeverity): TicketPriority {
  switch (severity) {
    case 'critical':
      return TicketPriority.URGENT;
    case 'major':
      return TicketPriority.HIGH;
    case 'minor':
      return TicketPriority.NORMAL;
    default:
      return TicketPriority.NORMAL;
  }
}

// ============================================================
// Handler
// ============================================================

interface SnagWithReport extends Snag {
  report_number: string | null;
  audit_date: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const user = getAuthUser(req);

  try {
    const { snag_id } = req.body as { snag_id?: string };

    if (!snag_id) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_id is required');
    }

    // 1. Fetch snag + report data
    const rows = await sql`
      SELECT s.*,
             sr.report_number,
             sr.audit_date
      FROM snags s
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      WHERE s.id = ${snag_id}
      LIMIT 1
    ` as SnagWithReport[];

    const snag = rows[0];
    if (!snag) {
      return apiResponse.notFound(res, 'Snag', snag_id);
    }

    if (snag.noc_ticket_id) {
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        `Snag already has a NOC ticket: ${snag.noc_ticket_id}`
      );
    }

    // 2. Build ticket payload
    const rawTitle = `[SNAG] #${snag.snag_number} - ${snag.description}`;
    const title = rawTitle.length > 100 ? rawTitle.slice(0, 97) + '...' : rawTitle;

    const poleRefs = (snag.pole_references ?? []).join(', ');
    const descParts = [
      snag.description,
      snag.report_number ? `Report: ${snag.report_number}` : null,
      snag.audit_date ? `Audit date: ${new Date(snag.audit_date).toLocaleDateString('en-ZA')}` : null,
      poleRefs ? `Poles: ${poleRefs}` : null,
      `Category: ${snag.category}`,
      `Severity: ${snag.severity}`,
    ].filter(Boolean);

    const ticket = await createTicket({
      source: TicketSource.CONSTRUCTION,
      source_type: 'snag',
      title,
      description: descParts.join('\n'),
      ticket_type: mapCategoryToTicketType(snag.category),
      priority: mapSeverityToPriority(snag.severity),
      project_id: snag.project_id,
      uid_prefix: 'SNG',
      created_by: user?.id ?? undefined,
      external_id: JSON.stringify({ snag_id: snag.id, tags: ['snag', snag.category] }),
    });

    // 3. Update snag: link ticket + set status = 'assigned'
    const updatedRows = await sql`
      UPDATE snags
      SET noc_ticket_id = ${ticket.id},
          status = 'assigned',
          updated_at = NOW()
      WHERE id = ${snag_id}
      RETURNING *
    ` as Snag[];

    const updatedSnag = updatedRows[0];
    if (!updatedSnag) {
      log.error('Failed to link NOC ticket to snag', { snag_id, ticket_id: ticket.id });
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to update snag');
    }

    log.info('NOC ticket created for snag', {
      snag_id,
      ticket_id: ticket.id,
      ticket_uid: ticket.ticket_uid,
    });

    // Attach noc_ticket_uid for immediate UI use
    const snagWithUid = { ...updatedSnag, noc_ticket_uid: ticket.ticket_uid };

    return apiResponse.created(res, { ticket, snag: snagWithUid });
  } catch (error) {
    log.error('create-ticket API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
