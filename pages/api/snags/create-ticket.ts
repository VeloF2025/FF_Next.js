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
import { notifySnagGroupOnCreate } from '@/modules/noc/services/snagGroupNotifications';
import {
  TicketSource,
  TicketType,
  TicketPriority,
  TicketStatus,
} from '@/modules/noc/types/ticket';
import type { Snag, SnagCategory, SnagSeverity } from '@/modules/construction-qa/types/snag.types';

const sql = neon(process.env.DATABASE_URL!);

// ============================================================
// Mapping helpers
// ============================================================

/** Map snag category → NOC ticket type */
function mapCategoryToTicketType(_category: SnagCategory): TicketType {
  // All snag categories map to the dedicated SNAG ticket type
  return TicketType.SNAG;
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

    // 1. Fetch snag + report + pole/drop + photo data
    const rows = await sql`
      SELECT s.*,
             sr.report_number,
             sr.audit_date,
             COALESCE(pole.longitude, dr.latitude) AS resolved_lat,
             COALESCE(pole.latitude, dr.longitude) AS resolved_lon,
             COALESCE(pole.zone_no, dr.zone_no) AS resolved_zone,
             COALESCE(pole.pon_no, dr.pon_no) AS resolved_pon,
             pole.id AS resolved_pole_uuid,
             pole.pole_number AS resolved_pole_number,
             dr.drop_number AS resolved_dr_number
      FROM snags s
      LEFT JOIN snag_reports sr ON sr.id = s.report_id
      LEFT JOIN poles pole ON pole.id = s.pole_ids[1]
      LEFT JOIN drops dr ON dr.id = s.drop_id
      WHERE s.id = ${snag_id}
      LIMIT 1
    ` as Array<SnagWithReport & {
      resolved_lat: string | null;
      resolved_lon: string | null;
      resolved_zone: number | null;
      resolved_pon: number | null;
      resolved_pole_uuid: string | null;
      resolved_pole_number: string | null;
      resolved_dr_number: string | null;
    }>;

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

    // 1b. Resolve project site manager for auto-assignment
    let siteManagerId: string | undefined;
    if (snag.project_id) {
      const managerRows = await sql`
        SELECT person_id FROM v_project_team
        WHERE project_id = ${snag.project_id}
          AND person_type = 'staff'
          AND is_active = true
          AND LOWER(role) = 'site manager'
        LIMIT 1
      ` as Array<{ person_id: string }>;
      siteManagerId = managerRows[0]?.person_id ?? undefined;
    }

    // 2. Build ticket payload
    const rawTitle = `[SNAG] #${snag.snag_number} - ${snag.description}`;
    const title = rawTitle.length > 100 ? rawTitle.slice(0, 97) + '...' : rawTitle;

    const poleRefs = (snag.pole_references ?? []).join(', ');
    const gpsStr = snag.resolved_lat && snag.resolved_lon
      ? `${snag.resolved_lat},${snag.resolved_lon}` : null;

    const descParts = [
      snag.description,
      '',
      snag.report_number ? `Report: ${snag.report_number}` : null,
      snag.audit_date ? `Audit date: ${new Date(snag.audit_date).toLocaleDateString('en-ZA')}` : null,
      poleRefs ? `Location: ${poleRefs}` : null,
      snag.resolved_zone != null ? `Zone: ${snag.resolved_zone}` : null,
      snag.resolved_pon != null ? `PON: ${snag.resolved_pon}` : null,
      gpsStr ? `GPS: ${gpsStr}` : null,
      `Category: ${snag.category}`,
      `Severity: ${snag.severity}`,
    ].filter(Boolean);

    const ticket = await createTicket({
      source: TicketSource.SNAGS,
      source_type: 'snag',
      title,
      description: descParts.join('\n'),
      ticket_type: mapCategoryToTicketType(snag.category),
      priority: mapSeverityToPriority(snag.severity),
      project_id: snag.project_id,
      uid_prefix: 'SNG',
      created_by: user?.id ?? undefined,
      dr_number: snag.resolved_dr_number ?? undefined,
      zone_id: snag.resolved_zone != null ? String(snag.resolved_zone) : undefined,
      pole_number: snag.resolved_pole_uuid ?? undefined,
      pon_number: snag.resolved_pon != null ? String(snag.resolved_pon) : undefined,
      address: gpsStr ?? undefined,
      external_id: JSON.stringify({ snag_id: snag.id, tags: ['snag', snag.category] }),
      // Auto-assign to project site manager if found
      ...(siteManagerId && {
        assigned_to: siteManagerId,
        status: TicketStatus.ASSIGNED,
      }),
    });

    // 2b. Set GPS coordinates on ticket (not available in CreateTicketPayload)
    if (gpsStr) {
      await sql`UPDATE maintenance_tickets SET gps_coordinates = ${gpsStr} WHERE id = ${ticket.id}`;
    }

    // 2c. Attach before photo to the ticket
    const photoRows = await sql`
      SELECT photo_url FROM snag_photos
      WHERE snag_id = ${snag_id} AND phase = 'before'
      LIMIT 1
    ` as Array<{ photo_url: string }>;

    if (photoRows[0]?.photo_url) {
      await sql`
        INSERT INTO maintenance_attachments (ticket_id, file_url, storage_url, filename, file_type, mime_type, uploaded_by, description)
        VALUES (${ticket.id}, ${photoRows[0].photo_url}, ${photoRows[0].photo_url}, 'snag-before-photo.jpg', 'image', 'image/jpeg', ${user?.id ?? null}, ${'Before photo from ' + (snag.report_number ?? 'TQR report')})
      `.catch((err) => {
        log.warn('Could not attach photo to ticket', { ticketId: ticket.id, error: err });
      });
    }

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

    // 3b. Fire WhatsApp group notification (non-blocking)
    notifySnagGroupOnCreate(ticket).catch(err => {
      log.warn('Snag WA group notification failed', { ticketId: ticket.id, error: err });
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
