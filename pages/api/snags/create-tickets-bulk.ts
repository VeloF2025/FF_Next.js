/**
 * POST /api/snags/create-tickets-bulk
 *
 * Creates NOC tickets for ALL open snags in a report that don't already have one.
 * Body: { report_id: string }
 *
 * Returns: { created: number, skipped: number, errors: number }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { createTicket } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/noc/types/ticket';
import type { Snag, SnagSeverity } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Mapping helpers (duplicated from create-ticket.ts intentionally
// to keep files independent and under 300 lines)
// ============================================================

function mapCategoryToTicketType(_category: string): TicketType {
  return TicketType.FAULT_REPAIR;
}

function mapSeverityToPriority(severity: SnagSeverity): TicketPriority {
  switch (severity) {
    case 'critical': return TicketPriority.URGENT;
    case 'major':    return TicketPriority.HIGH;
    case 'minor':    return TicketPriority.NORMAL;
    default:         return TicketPriority.NORMAL;
  }
}

interface SnagWithReport extends Snag {
  report_number: string | null;
  audit_date: string | null;
}

// ============================================================
// Handler
// ============================================================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  try {
    const { report_id } = req.body as { report_id?: string };

    if (!report_id) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'report_id is required');
    }

    // Fetch all open snags in the report without an existing NOC ticket
    const openSnags = await sql`
      SELECT s.*,
             sr.report_number,
             sr.audit_date
      FROM snags s
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      WHERE s.report_id = ${report_id}
        AND s.status = 'open'
        AND s.noc_ticket_id IS NULL
      ORDER BY s.snag_number ASC
    ` as SnagWithReport[];

    if (openSnags.length === 0) {
      return apiResponse.success(res, { created: 0, skipped: 0, errors: 0 });
    }

    let created = 0;
    let errors = 0;

    for (const snag of openSnags) {
      try {
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
          external_id: JSON.stringify({ snag_id: snag.id, tags: ['snag', snag.category] }),
        });

        await sql`
          UPDATE snags
          SET noc_ticket_id = ${ticket.id},
              status = 'assigned',
              updated_at = NOW()
          WHERE id = ${snag.id}
        `;

        created++;
        log.info('Bulk: NOC ticket created', { snag_id: snag.id, ticket_uid: ticket.ticket_uid });
      } catch (err) {
        errors++;
        log.error('Bulk: failed to create ticket for snag', { snag_id: snag.id, err });
      }
    }

    log.info('Bulk ticket creation complete', { report_id, created, errors });
    return apiResponse.success(res, { created, skipped: 0, errors });
  } catch (error) {
    log.error('create-tickets-bulk API error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
