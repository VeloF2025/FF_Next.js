/**
 * API Route: /api/activate/pp-data-tickets
 *
 * POST: Create maintenance tickets for selected PP Data records
 * PATCH: Backfill existing PP Data tickets with enrichment data
 *
 * Enrichment sources:
 * - drops table: project_id, zone_no, pon_no, pole_number, GPS, installed_by, installed_at
 * - onemap_properties: address, contact name/phone/email, installer, install date
 * - projects table: project UUID from project name
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';
import { createTicket } from '@/modules/noc/services/ticketService';
import { TicketSource, TicketType, TicketPriority, TicketStatus } from '@/modules/noc/types/ticket';
import { createLogger } from '@/lib/logger';

const logger = createLogger('activate:pp-data-tickets');

const VALID_TICKET_TYPES: string[] = [
  TicketType.MAINTENANCE,
  TicketType.ACTIVATIONS,
  TicketType.OPTICAL,
  TicketType.CIVILS,
];

interface EnrichmentData {
  project_id?: string;
  address?: string;
  zone?: string;
  pon?: string;
  pole_number?: string;
  lat?: string;
  lng?: string;
  client_name?: string;
  client_contact?: string;
  client_email?: string;
  installer_name?: string;
  installed_at?: string;
}

/**
 * Fetch enrichment data for a DR number from drops + onemap_properties
 */
async function getEnrichmentForDR(drNumber: string, projectName?: string): Promise<EnrichmentData> {
  const result = await pool.query(
    `SELECT
       d.project_id::text as drop_project_id,
       d.address as drop_address,
       d.zone_no::text as zone_no,
       d.pon_no::text as pon_no,
       d.pole_number,
       d.latitude::text as drop_lat,
       d.longitude::text as drop_lng,
       d.installed_by_name,
       d.installed_at::text as installed_at,
       op.location_address as omap_address,
       op.latitude::text as omap_lat,
       op.longitude::text as omap_lng,
       op.pole_number as omap_pole,
       op.pons as omap_pon,
       op.sections as omap_section,
       TRIM(COALESCE(op.contact_name, '') || ' ' || COALESCE(op.contact_surname, '')) as client_name,
       op.contact_number,
       op.email_address,
       op.installer_name as omap_installer,
       op.installation_date::text as omap_install_date
     FROM drops d
     LEFT JOIN onemap_properties op ON op.drop_number = d.drop_number
     WHERE d.drop_number = $1
     LIMIT 1`,
    [drNumber]
  );

  if (result.rows.length === 0) {
    // No drop found — try project lookup at least
    return await getProjectId(projectName);
  }

  const r = result.rows[0];
  const enrichment: EnrichmentData = {};

  // Project ID: prefer drop's project_id, fallback to name lookup
  enrichment.project_id = r.drop_project_id || undefined;
  if (!enrichment.project_id && projectName) {
    const proj = await getProjectId(projectName);
    enrichment.project_id = proj.project_id;
  }

  // Address: prefer 1Map (more detailed), fallback to drops
  enrichment.address = r.omap_address || r.drop_address || undefined;

  // Zone & PON from drops
  enrichment.zone = r.zone_no || undefined;
  enrichment.pon = r.pon_no || undefined;

  // Pole from drops (1Map pole often null)
  enrichment.pole_number = r.pole_number || r.omap_pole || undefined;

  // GPS: prefer drops (usually present), fallback 1Map
  enrichment.lat = r.drop_lat || r.omap_lat || undefined;
  enrichment.lng = r.drop_lng || r.omap_lng || undefined;

  // Client info from 1Map
  const clientName = (r.client_name || '').trim();
  enrichment.client_name = clientName || undefined;
  enrichment.client_contact = r.contact_number || undefined;
  enrichment.client_email = r.email_address || undefined;

  // Installer
  enrichment.installer_name = r.installed_by_name || r.omap_installer || undefined;
  enrichment.installed_at = r.installed_at || r.omap_install_date || undefined;

  return enrichment;
}

/**
 * Look up project UUID from project name
 */
async function getProjectId(projectName?: string): Promise<EnrichmentData> {
  if (!projectName) return {};
  const result = await pool.query(
    `SELECT id::text as project_id FROM projects WHERE project_name = $1 LIMIT 1`,
    [projectName]
  );
  return { project_id: result.rows[0]?.project_id || undefined };
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method === 'POST') {
    return handleCreate(authReq, res);
  }
  if (req.method === 'PATCH') {
    return handleBackfill(authReq, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST', 'PATCH']);
}

/**
 * POST: Create enriched PP Data tickets
 */
async function handleCreate(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const { pp_data_ids, ticket_type, priority, notes, assigned_team_id } = req.body;

  if (!Array.isArray(pp_data_ids) || pp_data_ids.length === 0) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
  }

  if (!ticket_type || !VALID_TICKET_TYPES.includes(ticket_type)) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, `ticket_type must be one of: ${VALID_TICKET_TYPES.join(', ')}`);
  }

  const ticketPriority = priority && Object.values(TicketPriority).includes(priority)
    ? priority
    : TicketPriority.NORMAL;

  try {
    const eligible = await pool.query(
      `SELECT id, serial_number, resolved_drop_number, project, resolution_status
       FROM oes_pp_data
       WHERE id = ANY($1)
         AND maintenance_ticket_id IS NULL
         AND resolution_status != 'activated'`,
      [pp_data_ids]
    );

    const records = eligible.rows;
    const skipped = pp_data_ids.length - records.length;

    if (records.length === 0) {
      return apiResponse.success(res, { created: 0, skipped: pp_data_ids.length, tickets: [] });
    }

    logger.info('Creating enriched PP Data tickets', {
      eligible: records.length, skipped, ticket_type, assigned_team_id: assigned_team_id || null,
    });

    const tickets: { id: string; ticket_uid: string; pp_data_id: number }[] = [];
    const projectCounts: Record<string, number> = {};

    for (const record of records) {
      const dr = record.resolved_drop_number;
      const serial = record.serial_number;
      const project = record.project || 'Unknown';

      projectCounts[project] = (projectCounts[project] || 0) + 1;

      // Fetch enrichment data from drops + onemap_properties
      const enrichment = dr
        ? await getEnrichmentForDR(dr, project)
        : await getProjectId(project);

      // Build enriched title
      const locationParts: string[] = [];
      if (enrichment.pole_number) locationParts.push(`Pole: ${enrichment.pole_number}`);
      if (enrichment.zone) locationParts.push(`Zone ${enrichment.zone}`);
      if (enrichment.pon) locationParts.push(`PON ${enrichment.pon}`);

      const title = dr
        ? `PP ONT ${serial} at ${dr}`
        : `PP ONT ${serial} — No DR (Project: ${project})`;

      // Build enriched description
      const descParts: string[] = [];
      descParts.push(dr
        ? `PP Data investigation: ONT ${serial} located at DR ${dr} (Project: ${project})`
        : `PP Data investigation: ONT ${serial} — not found in any source (Project: ${project}). Requires physical verification.`);

      if (locationParts.length > 0) descParts.push(`Location: ${locationParts.join(', ')}`);
      if (enrichment.address) descParts.push(`Address: ${enrichment.address}`);
      if (enrichment.client_name) descParts.push(`End User: ${enrichment.client_name}`);
      if (enrichment.client_contact) descParts.push(`Contact: ${enrichment.client_contact}`);
      if (enrichment.installer_name) descParts.push(`Installer: ${enrichment.installer_name}`);
      if (enrichment.installed_at) descParts.push(`Installed: ${enrichment.installed_at}`);

      const description = notes || descParts.join('\n');

      const ticket = await createTicket({
        source: TicketSource.PP_DATA,
        title,
        ticket_type: ticket_type as TicketType,
        priority: ticketPriority,
        description,
        dr_number: dr || undefined,
        ont_serial: serial,
        created_by: req.user.id,
        assigned_team_id: assigned_team_id || undefined,
        status: assigned_team_id ? TicketStatus.ASSIGNED : undefined,
        project_id: enrichment.project_id || undefined,
        address: enrichment.address || undefined,
        zone_id: enrichment.zone || undefined,
        pon_number: enrichment.pon || undefined,
        // Note: pole_number maps to pole_id (UUID) column — store pole label in description instead
        client_name: enrichment.client_name || undefined,
        client_contact: enrichment.client_contact || undefined,
        client_email: enrichment.client_email || undefined,
      });

      // Set GPS coordinates directly (createTicket doesn't handle text GPS format)
      if (enrichment.lat && enrichment.lng) {
        await pool.query(
          `UPDATE maintenance_tickets SET gps_coordinates = $1 WHERE id = $2`,
          [`${enrichment.lat},${enrichment.lng}`, ticket.id]
        );
      }

      // Link ticket back to PP data record
      await pool.query(
        `UPDATE oes_pp_data SET maintenance_ticket_id = $1 WHERE id = $2`,
        [ticket.id, record.id]
      );

      tickets.push({ id: ticket.id, ticket_uid: ticket.ticket_uid, pp_data_id: record.id });
    }

    logger.info('PP Data tickets created', { created: tickets.length, skipped });

    if (assigned_team_id && tickets.length > 0) {
      sendTeamNotification(assigned_team_id, tickets, projectCounts).catch((err) => {
        logger.error('Failed to send team notification email', { error: err });
      });
    }

    return apiResponse.success(res, { created: tickets.length, skipped, tickets });
  } catch (err) {
    logger.error('Failed to create PP Data tickets', { error: err });
    return apiResponse.internalError(res, err);
  }
}

/**
 * PATCH: Backfill existing PP Data tickets with enrichment data
 *
 * Syncs DR numbers from oes_pp_data → ticket when PP data has been resolved since creation.
 * Updates title, description, and all enrichable fields (address, GPS, zone, PON, client info).
 * Uses upsert logic: overwrites empty fields, preserves manually-entered data.
 */
async function handleBackfill(
  _req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  try {
    // Fetch all pp_data tickets with their linked PP record
    const tickets = await pool.query(
      `SELECT mt.id, mt.dr_number, mt.ont_serial, mt.title, mt.description,
              mt.project_id, mt.address, mt.gps_coordinates, mt.zone, mt.pon,
              mt.client_name, mt.client_contact, mt.client_email,
              pp.resolved_drop_number, pp.resolution_status, pp.project as pp_project
       FROM maintenance_tickets mt
       JOIN oes_pp_data pp ON pp.maintenance_ticket_id = mt.id
       WHERE mt.source = 'pp_data'`
    );

    let updated = 0;
    let drSynced = 0;

    for (const ticket of tickets.rows) {
      // Use PP data's resolved DR (latest), fall back to ticket's existing DR
      const ppDR = ticket.resolved_drop_number;
      const ticketDR = ticket.dr_number;
      const effectiveDR = ppDR || ticketDR;
      const projectName = ticket.pp_project;
      const serial = ticket.ont_serial || '';

      // Track if DR was newly synced from PP data
      const drNewlySynced = ppDR && !ticketDR;

      // Fetch enrichment using the effective DR
      const enrichment = effectiveDR
        ? await getEnrichmentForDR(effectiveDR, projectName)
        : await getProjectId(projectName);

      const updates: string[] = [];
      const values: (string | null)[] = [];
      let paramIdx = 1;

      // Helper: set field if enrichment has a value and ticket field is empty
      const upsertField = (column: string, newValue: string | undefined, currentValue: string | null | undefined) => {
        if (newValue && !currentValue) {
          updates.push(`${column} = $${paramIdx}`);
          values.push(newValue);
          paramIdx++;
        }
      };

      // Sync DR number from PP data → ticket
      if (drNewlySynced) {
        updates.push(`dr_number = $${paramIdx}`);
        values.push(ppDR);
        paramIdx++;
        drSynced++;
      }

      // Update title if DR was newly synced (replace "No DR" title)
      if (drNewlySynced && ticket.title.includes('No DR')) {
        const newTitle = `PP ONT ${serial} at ${ppDR}`;
        updates.push(`title = $${paramIdx}`);
        values.push(newTitle);
        paramIdx++;
      }

      // Upsert all enrichable fields
      upsertField('project_id', enrichment.project_id, ticket.project_id);
      upsertField('address', enrichment.address, ticket.address);
      upsertField('zone', enrichment.zone, ticket.zone);
      upsertField('pon', enrichment.pon, ticket.pon);
      upsertField('client_name', enrichment.client_name, ticket.client_name);
      upsertField('client_contact', enrichment.client_contact, ticket.client_contact);
      upsertField('client_email', enrichment.client_email, ticket.client_email);

      // GPS
      if (enrichment.lat && enrichment.lng && !ticket.gps_coordinates) {
        updates.push(`gps_coordinates = $${paramIdx}`);
        values.push(`${enrichment.lat},${enrichment.lng}`);
        paramIdx++;
      }

      // Build enrichment block for description
      const descParts: string[] = [];
      if (effectiveDR) descParts.push(`DR: ${effectiveDR}`);
      if (enrichment.pole_number) descParts.push(`Pole: ${enrichment.pole_number}`);
      if (enrichment.zone) descParts.push(`Zone ${enrichment.zone}`);
      if (enrichment.pon) descParts.push(`PON ${enrichment.pon}`);
      if (enrichment.address) descParts.push(`Address: ${enrichment.address}`);
      if (enrichment.client_name) descParts.push(`End User: ${enrichment.client_name}`);
      if (enrichment.client_contact) descParts.push(`Contact: ${enrichment.client_contact}`);
      if (enrichment.installer_name) descParts.push(`Installer: ${enrichment.installer_name}`);
      if (enrichment.installed_at) descParts.push(`Installed: ${enrichment.installed_at}`);

      if (descParts.length > 0) {
        const currentDesc = ticket.description || '';
        const enrichmentBlock = `\n--- Enrichment Data ---\n${descParts.join('\n')}`;

        if (currentDesc.includes('--- Enrichment Data ---')) {
          // Replace existing enrichment block
          const baseDesc = currentDesc.split('\n--- Enrichment Data ---')[0];
          updates.push(`description = $${paramIdx}`);
          values.push(baseDesc + enrichmentBlock);
          paramIdx++;
        } else {
          // Append new enrichment block
          updates.push(`description = COALESCE(description, '') || $${paramIdx}`);
          values.push(enrichmentBlock);
          paramIdx++;
        }
      }

      if (updates.length === 0) continue;

      updates.push(`updated_at = NOW()`);
      values.push(ticket.id);

      await pool.query(
        `UPDATE maintenance_tickets SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
        values
      );

      updated++;
    }

    logger.info('PP Data tickets backfill complete', {
      total: tickets.rows.length, updated, drSynced,
    });

    return apiResponse.success(res, {
      total: tickets.rows.length,
      updated,
      dr_synced: drSynced,
    });
  } catch (err) {
    logger.error('Failed to backfill PP Data tickets', { error: err });
    return apiResponse.internalError(res, err);
  }
}

/**
 * Send summary email to all team members about newly created PP Data tickets.
 */
async function sendTeamNotification(
  teamId: string,
  tickets: { id: string; ticket_uid: string; pp_data_id: number }[],
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
    logger.warn('No active team members with email found for notification', { teamId });
    return;
  }

  const teamName = members[0].team_name || 'Assigned Team';
  const ticketUids = tickets.map(t => t.ticket_uid);

  const breakdown = Object.entries(projectCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([project, count]) => `${project}: ${count}`)
    .join(', ');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fibreflow.app';
  const nocUrl = `${appUrl}/noc?source=pp_data`;

  const subject = `${tickets.length} PP Data Maintenance Tickets Assigned to ${teamName}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;background-color:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <tr><td style="padding:32px 40px;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:8px 8px 0 0;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">PP Data Tickets Assigned</h1>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">
            <strong>${tickets.length}</strong> maintenance tickets have been created from PP Data records
            and assigned to <strong>${teamName}</strong>.
          </p>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;font-weight:600;">Project Breakdown:</p>
          <p style="margin:0 0 24px;font-size:14px;color:#374151;">${breakdown}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#6b7280;font-weight:600;">Ticket UIDs:</p>
          <p style="margin:0 0 24px;font-size:13px;color:#374151;font-family:monospace;word-break:break-all;">
            ${ticketUids.join(', ')}
          </p>
          <table cellpadding="0" cellspacing="0"><tr><td style="background-color:#f59e0b;border-radius:6px;">
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
    from: 'FibreFlow <notifications@fibreflow.app>',
    to: emails,
    subject,
    html,
  });

  logger.info('Team notification email sent', {
    teamId, teamName, recipientCount: emails.length, ticketCount: tickets.length,
  });
}

export default withAuth(withRole('manager')(handler));
