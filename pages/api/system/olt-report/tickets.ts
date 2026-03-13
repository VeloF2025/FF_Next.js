/**
 * API Route: /api/system/olt-report/tickets
 *
 * POST: Create maintenance tickets for selected OLT mismatch records
 * Similar to pp-data-tickets.ts but for OLT serial mismatches.
 */

import type { NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';
import { createTicket } from '@/modules/noc/services/ticketService';
import { TicketSource, TicketType, TicketPriority, TicketStatus } from '@/modules/noc/types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('olt-report:tickets');

const VALID_TICKET_TYPES: string[] = [
  TicketType.OLT_INVESTIGATION,
  TicketType.SERIAL_MISMATCH,
  TicketType.FAULT_REPAIR,
  TicketType.ONT_SWAP,
];

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  const { record_ids, ticket_type, priority, notes, assigned_team_id } = req.body;

  if (!Array.isArray(record_ids) || record_ids.length === 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid record_ids');
  }

  if (!ticket_type || !VALID_TICKET_TYPES.includes(ticket_type)) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, `ticket_type must be one of: ${VALID_TICKET_TYPES.join(', ')}`);
  }

  const ticketPriority = priority && Object.values(TicketPriority).includes(priority)
    ? priority
    : TicketPriority.NORMAL;

  try {
    // Fetch eligible records: needs_investigation or not_found, not yet ticketed
    const eligible = await pool.query(
      `SELECT id, drop_number, olt_serial, wrong_onemap_serial, fix_status,
              investigation_context
       FROM olt_mismatch_records
       WHERE id = ANY($1)
         AND fix_status IN ('needs_investigation', 'not_found', 'empty_serial')
         AND maintenance_ticket_id IS NULL`,
      [record_ids]
    );

    const records = eligible.rows;
    const skipped = record_ids.length - records.length;

    if (records.length === 0) {
      return apiResponse.success(res, {
        created: 0, skipped: record_ids.length, tickets: [],
      });
    }

    logger.info('Creating OLT mismatch maintenance tickets', {
      eligible: records.length,
      skipped,
      ticket_type,
      assigned_team_id: assigned_team_id || null,
    });

    const tickets: { id: string; ticket_uid: string; record_id: string }[] = [];
    const projectCounts: Record<string, number> = {};

    for (const record of records) {
      const dr = record.drop_number as string;
      const oltSerial = record.olt_serial as string;
      const wrongSerial = record.wrong_onemap_serial as string | null;
      const status = record.fix_status as string;

      // Try to get project from investigation_context
      let project = 'Unknown';
      try {
        if (record.investigation_context) {
          const ctx = typeof record.investigation_context === 'string'
            ? JSON.parse(record.investigation_context)
            : record.investigation_context;
          project = ctx.belongsToTeam || project;
        }
      } catch { /* ignore parse errors */ }

      projectCounts[project] = (projectCounts[project] || 0) + 1;

      // Build title based on mismatch type
      let title: string;
      let description: string;

      if (status === 'not_found') {
        title = `OLT Mismatch: ${dr} — ONT ${oltSerial} not on 1Map`;
        description = notes || `OLT report shows ONT serial ${oltSerial} for ${dr}, but this DR is not found on 1Map. Requires investigation to confirm installation status and update records.`;
      } else if (wrongSerial) {
        title = `OLT Mismatch: ${dr} — Wrong serial on 1Map`;
        description = notes || `OLT report shows ONT serial ${oltSerial} for ${dr}, but 1Map has ${wrongSerial}. Serial mismatch requires investigation — possible swap or data entry error.`;
      } else {
        title = `OLT Mismatch: ${dr} — Serial investigation needed`;
        description = notes || `OLT report flagged ${dr} with ONT serial ${oltSerial} for investigation. Current status: ${status}.`;
      }

      const ticket = await createTicket({
        source: TicketSource.OLT_MISMATCH,
        title,
        ticket_type: ticket_type as TicketType,
        priority: ticketPriority,
        description,
        dr_number: dr,
        ont_serial: oltSerial,
        created_by: req.user.id,
        assigned_team_id: assigned_team_id || undefined,
        status: assigned_team_id ? TicketStatus.ASSIGNED : undefined,
      });

      // Link ticket back to mismatch record
      await pool.query(
        `UPDATE olt_mismatch_records SET maintenance_ticket_id = $1 WHERE id = $2`,
        [ticket.id, record.id]
      );

      tickets.push({
        id: ticket.id,
        ticket_uid: ticket.ticket_uid,
        record_id: record.id,
      });
    }

    logger.info('OLT mismatch tickets created', { created: tickets.length, skipped });

    // Send email notification to team members if team was assigned
    if (assigned_team_id && tickets.length > 0) {
      sendTeamNotification(assigned_team_id, tickets, projectCounts).catch((err) => {
        logger.error('Failed to send team notification email', { error: err });
      });
    }

    return apiResponse.success(res, {
      created: tickets.length, skipped, tickets,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    logger.error('Failed to create OLT mismatch tickets', { error: errMsg, stack: errStack });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, `Ticket creation failed: ${errMsg}`);
  }
}

/**
 * Send summary email to team members about newly created OLT mismatch tickets.
 */
async function sendTeamNotification(
  teamId: string,
  tickets: { id: string; ticket_uid: string; record_id: string }[],
  projectCounts: Record<string, number>
): Promise<void> {
  const teamResult = await pool.query(
    `SELECT t.name AS team_name, tm.first_name, tm.email
     FROM teams t
     JOIN team_members tm ON tm.team_id = t.id
     WHERE t.id = $1 AND tm.is_active = TRUE AND tm.email IS NOT NULL`,
    [teamId]
  );

  const members = teamResult.rows;
  if (members.length === 0) {
    logger.warn('No active team members with email found', { teamId });
    return;
  }

  const teamName = members[0].team_name || 'Assigned Team';
  const ticketUids = tickets.map(t => t.ticket_uid);

  const breakdown = Object.entries(projectCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([project, count]) => `${project}: ${count}`)
    .join(', ');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';
  const nocUrl = `${appUrl}/noc?source=olt_mismatch`;

  const subject = `${tickets.length} OLT Mismatch Tickets Assigned to ${teamName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#dc2626,#991b1b);border-radius:8px 8px 0 0;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">OLT Serial Mismatch Tickets</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">
            <strong>${tickets.length}</strong> investigation tickets have been created from OLT report mismatches
            and assigned to <strong>${teamName}</strong>.
          </p>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;font-weight:600;">Breakdown:</p>
          <p style="margin:0 0 24px;font-size:14px;color:#374151;">${breakdown}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;font-weight:600;">Ticket UIDs:</p>
          <p style="margin:0 0 24px;font-size:13px;color:#374151;font-family:monospace;word-break:break-all;">
            ${ticketUids.join(', ')}
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td style="background-color:#dc2626;border-radius:6px;">
            <a href="${nocUrl}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
              View in NOC
            </a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:24px 40px;background-color:#f9fafb;border-radius:0 0 8px 8px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-size:12px;color:#6b7280;text-align:center;">FibreFlow Notifications</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  const { resend } = await import('@/lib/email/resendClient');
  const emails = members.map((m: { email: string }) => m.email);

  await resend.emails.send({
    from: 'FibreFlow <noreply@fibreflow.app>',
    to: emails,
    subject,
    html,
  });

  logger.info('OLT mismatch team notification sent', {
    teamId,
    teamName,
    recipientCount: emails.length,
    ticketCount: tickets.length,
  });
}

export default withAuth(withRole('manager')(handler as never));
