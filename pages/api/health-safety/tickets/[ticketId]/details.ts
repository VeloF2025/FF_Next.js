/**
 * H&S Ticket Details API
 *
 * GET  /api/health-safety/tickets/[ticketId]/details - Get H&S details for ticket
 * PUT  /api/health-safety/tickets/[ticketId]/details - Update H&S details
 * POST /api/health-safety/tickets/[ticketId]/details - Create H&S details for existing ticket
 *
 * This extends the maintenance ticketing system with H&S-specific fields.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import {
  INCIDENT_TYPE_CONFIG,
  SEVERITY_TO_PRIORITY,
  SEVERITY_SLA_HOURS,
} from '@/modules/health-safety/types/ticket.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { ticketId } = req.query;

  if (!ticketId || typeof ticketId !== 'string') {
    return apiResponse.badRequest(res, 'Ticket ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(ticketId, res);
      case 'PUT':
        return handlePut(ticketId, req, res);
      case 'POST':
        return handlePost(ticketId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    console.error('[H&S Ticket Details API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(ticketId: string, res: NextApiResponse) {
  // Get ticket with H&S details
  const [ticket] = await sql`
    SELECT
      t.*,
      hd.*,
      p.project_name,
      c.company_name as contractor_name,
      s.full_name as assigned_to_name
    FROM tickets t
    LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN contractors c ON c.id = t.contractor_id
    LEFT JOIN staff s ON s.id = t.assigned_to
    WHERE t.id = ${ticketId}
  `;

  if (!ticket) {
    return apiResponse.notFound(res, 'Ticket', ticketId);
  }

  // Check if this is an H&S ticket
  const isHSTicket = ['hse_incident', 'hse_near_miss'].includes(ticket.ticket_type);

  if (!isHSTicket) {
    return apiResponse.badRequest(res, 'This ticket is not an H&S ticket');
  }

  // Get investigation info if exists
  const investigation = ticket.investigation_started_at
    ? {
        started_at: ticket.investigation_started_at,
        completed_at: ticket.investigation_completed_at,
        lead: ticket.investigation_lead,
        findings: ticket.investigation_findings,
        root_cause: ticket.root_cause,
      }
    : null;

  // Get corrective actions
  const correctiveActions = ticket.corrective_actions || [];

  // Get injured persons
  const injuredPersons = ticket.injured_persons || [];

  // Get witnesses
  const witnesses = ticket.witnesses || [];

  return apiResponse.success(res, {
    ticket: {
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      ticket_type: ticket.ticket_type,
      project_id: ticket.project_id,
      project_name: ticket.project_name,
      contractor_id: ticket.contractor_id,
      contractor_name: ticket.contractor_name,
      assigned_to: ticket.assigned_to,
      assigned_to_name: ticket.assigned_to_name,
      created_at: ticket.created_at,
      updated_at: ticket.updated_at,
      due_date: ticket.due_date,
    },
    hs_details: ticket.incident_type
      ? {
          id: ticket.id, // hs_ticket_details id
          incident_type: ticket.incident_type,
          severity: ticket.severity,
          incident_date: ticket.incident_date,
          incident_time: ticket.incident_time,
          location: ticket.location,
          description: ticket.description,
          immediate_actions: ticket.immediate_actions,
          dol_reportable: ticket.dol_reportable,
          dol_reported: ticket.dol_reported,
          dol_report_date: ticket.dol_report_date,
          corrective_action_required: ticket.corrective_action_required,
          photos: ticket.photos,
          type_info: INCIDENT_TYPE_CONFIG[ticket.incident_type as keyof typeof INCIDENT_TYPE_CONFIG],
        }
      : null,
    investigation,
    corrective_actions: correctiveActions,
    injured_persons: injuredPersons,
    witnesses,
    sla: {
      priority: ticket.priority,
      sla_hours: SEVERITY_SLA_HOURS[ticket.severity as keyof typeof SEVERITY_SLA_HOURS] || 72,
      due_date: ticket.due_date,
      is_overdue: ticket.due_date && new Date(ticket.due_date) < new Date(),
    },
  });
}

async function handlePut(ticketId: string, req: NextApiRequest, res: NextApiResponse) {
  const {
    incident_type,
    severity,
    incident_date,
    incident_time,
    location,
    description,
    immediate_actions,
    dol_reportable,
    dol_reported,
    dol_report_date,
    corrective_action_required,
    photos,
    injured_persons,
    witnesses,
    investigation,
    corrective_actions,
  } = req.body;

  // Get existing ticket
  const [existing] = await sql`
    SELECT t.*, hd.id as hs_details_id
    FROM tickets t
    LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    WHERE t.id = ${ticketId}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Ticket', ticketId);
  }

  if (!existing.hs_details_id) {
    return apiResponse.badRequest(res, 'No H&S details exist for this ticket. Use POST to create.');
  }

  // Update priority if severity changed
  let newPriority = existing.priority;
  if (severity && SEVERITY_TO_PRIORITY[severity as keyof typeof SEVERITY_TO_PRIORITY]) {
    newPriority = SEVERITY_TO_PRIORITY[severity as keyof typeof SEVERITY_TO_PRIORITY];
  }

  // Update H&S details
  await sql`
    UPDATE hs_ticket_details
    SET
      incident_type = COALESCE(${incident_type}, incident_type),
      severity = COALESCE(${severity}, severity),
      incident_date = COALESCE(${incident_date}, incident_date),
      incident_time = COALESCE(${incident_time}, incident_time),
      location = COALESCE(${location}, location),
      description = COALESCE(${description}, description),
      immediate_actions = COALESCE(${immediate_actions}, immediate_actions),
      dol_reportable = COALESCE(${dol_reportable}, dol_reportable),
      dol_reported = COALESCE(${dol_reported}, dol_reported),
      dol_report_date = COALESCE(${dol_report_date}, dol_report_date),
      corrective_action_required = COALESCE(${corrective_action_required}, corrective_action_required),
      photos = COALESCE(${photos ? JSON.stringify(photos) : null}::jsonb, photos),
      injured_persons = COALESCE(${injured_persons ? JSON.stringify(injured_persons) : null}::jsonb, injured_persons),
      witnesses = COALESCE(${witnesses ? JSON.stringify(witnesses) : null}::jsonb, witnesses),
      investigation_started_at = COALESCE(${investigation?.started_at}, investigation_started_at),
      investigation_completed_at = COALESCE(${investigation?.completed_at}, investigation_completed_at),
      investigation_lead = COALESCE(${investigation?.lead}, investigation_lead),
      investigation_findings = COALESCE(${investigation?.findings}, investigation_findings),
      root_cause = COALESCE(${investigation?.root_cause}, root_cause),
      corrective_actions = COALESCE(${corrective_actions ? JSON.stringify(corrective_actions) : null}::jsonb, corrective_actions),
      updated_at = NOW()
    WHERE ticket_id = ${ticketId}
  `;

  // Update main ticket if priority changed
  if (newPriority !== existing.priority) {
    await sql`
      UPDATE tickets
      SET priority = ${newPriority}, updated_at = NOW()
      WHERE id = ${ticketId}
    `;
  }

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('hs_ticket', ${ticketId}, 'updated', ${JSON.stringify({
      ticket_id: ticketId,
      severity,
      incident_type,
    })}::jsonb)
  `;

  return handleGet(ticketId, res);
}

async function handlePost(ticketId: string, req: NextApiRequest, res: NextApiResponse) {
  const {
    incident_type,
    severity = 'moderate',
    incident_date,
    incident_time,
    location,
    description,
    immediate_actions,
    dol_reportable = false,
    corrective_action_required = false,
    photos,
    injured_persons,
    witnesses,
  } = req.body;

  if (!incident_type) {
    return apiResponse.badRequest(res, 'Incident type is required');
  }

  // Get existing ticket
  const [existing] = await sql`
    SELECT t.*, hd.id as hs_details_id
    FROM tickets t
    LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    WHERE t.id = ${ticketId}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Ticket', ticketId);
  }

  if (existing.hs_details_id) {
    return apiResponse.badRequest(res, 'H&S details already exist for this ticket. Use PUT to update.');
  }

  // Create H&S details
  await sql`
    INSERT INTO hs_ticket_details (
      ticket_id, incident_type, severity, incident_date, incident_time,
      location, description, immediate_actions, dol_reportable,
      corrective_action_required, photos, injured_persons, witnesses
    ) VALUES (
      ${ticketId},
      ${incident_type},
      ${severity},
      ${incident_date || new Date().toISOString().split('T')[0]},
      ${incident_time || null},
      ${location || null},
      ${description || null},
      ${immediate_actions || null},
      ${dol_reportable},
      ${corrective_action_required},
      ${photos ? JSON.stringify(photos) : '[]'}::jsonb,
      ${injured_persons ? JSON.stringify(injured_persons) : '[]'}::jsonb,
      ${witnesses ? JSON.stringify(witnesses) : '[]'}::jsonb
    )
  `;

  // Update ticket priority based on severity
  const priority = SEVERITY_TO_PRIORITY[severity as keyof typeof SEVERITY_TO_PRIORITY] || 'medium';
  await sql`
    UPDATE tickets
    SET priority = ${priority}, updated_at = NOW()
    WHERE id = ${ticketId}
  `;

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('hs_ticket', ${ticketId}, 'created', ${JSON.stringify({
      ticket_id: ticketId,
      incident_type,
      severity,
    })}::jsonb)
  `;

  return handleGet(ticketId, res);
}
