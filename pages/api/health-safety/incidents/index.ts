/**
 * H&S Incidents API
 *
 * GET  /api/health-safety/incidents - List H&S incidents
 * POST /api/health-safety/incidents - Create new incident (creates maintenance ticket + H&S details)
 *
 * This is the entry point for reporting H&S incidents. It creates a ticket in
 * the maintenance system with H&S-specific details attached.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  INCIDENT_TYPE_CONFIG,
  SEVERITY_TO_PRIORITY,
  SEVERITY_SLA_HOURS,
} from '@/modules/health-safety/types/ticket.types';
import { createTicket } from '@/modules/noc/services/ticketService';
import {
  TicketSource,
  TicketType,
  TicketPriority,
} from '@/modules/noc/types/ticket';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

const PRIORITY_MAP: Record<string, TicketPriority> = {
  low: TicketPriority.LOW,
  normal: TicketPriority.NORMAL,
  medium: TicketPriority.NORMAL,
  high: TicketPriority.HIGH,
  urgent: TicketPriority.URGENT,
  critical: TicketPriority.CRITICAL,
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[H&S Incidents API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const {
    project_id,
    contractor_id,
    severity,
    status,
    dol_reportable,
    limit = '50',
    offset = '0',
  } = req.query;

  // Check if maintenance_tickets table exists
  const ticketsTableExists = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'maintenance_tickets'
    ) as exists
  `;

  if (!ticketsTableExists[0]?.exists) {
    return apiResponse.success(res, {
      incidents: [],
      total: 0,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
      stats: {
        total: 0,
        critical: 0,
        major: 0,
        open: 0,
        dol_reportable: 0,
        dol_pending: 0,
        ca_pending: 0,
      },
    });
  }

  // Build explicit filter combinations — avoid conditional SQL fragments (Neon rule).
  // We use a helper to avoid 32 branches: encode active filters as a bitmask, then
  // split into two groups: (incidents/count use all 5 filters; stats uses only project+contractor).
  const dolFilter = dol_reportable === 'true';

  // Incidents list query — branching on the 5 optional filters
  let incidents;
  if (project_id && contractor_id && severity && status && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity} AND t.status = ${status} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id && severity && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity} AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id && severity && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id && status && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND t.status = ${status} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id && severity) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && contractor_id) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && severity && status && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND hd.severity = ${severity}
        AND t.status = ${status} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && severity && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND hd.severity = ${severity} AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && severity) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND hd.severity = ${severity}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (project_id) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.project_id = ${project_id}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (contractor_id && severity && status && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND hd.severity = ${severity}
        AND t.status = ${status} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (contractor_id && severity && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND hd.severity = ${severity} AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (contractor_id && severity) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND hd.severity = ${severity}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (contractor_id && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (contractor_id) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.contractor_id = ${contractor_id}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (severity && status && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND hd.severity = ${severity} AND t.status = ${status} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (severity && status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND hd.severity = ${severity} AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (severity) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND hd.severity = ${severity}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (status && dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.status = ${status} AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (status) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.status = ${status}
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else if (dolFilter) {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND hd.dol_reportable = true
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  } else {
    incidents = await sql`
      SELECT t.id, t.ticket_uid, t.title, t.description, t.status, t.priority, t.source_type,
             t.created_at, t.updated_at, t.project_id, hd.severity, hd.dol_reportable,
             hd.dol_reported, hd.corrective_action_required, hd.root_cause, p.project_name
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      LEFT JOIN projects p ON p.id::text = t.project_id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
      ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
    `;
  }

  // Count query — same filter logic, same branches
  let countRow;
  if (project_id && contractor_id && severity && status && dolFilter) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity} AND t.status = ${status} AND hd.dol_reportable = true
    `;
  } else if (project_id && contractor_id && severity && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity} AND t.status = ${status}
    `;
  } else if (project_id && contractor_id && severity && dolFilter) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND hd.severity = ${severity} AND hd.dol_reportable = true
    `;
  } else if (project_id && contractor_id && status && dolFilter) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
        AND t.status = ${status} AND hd.dol_reportable = true
    `;
  } else if (project_id && contractor_id && severity) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id} AND hd.severity = ${severity}
    `;
  } else if (project_id && contractor_id && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id} AND t.status = ${status}
    `;
  } else if (project_id && contractor_id && dolFilter) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id} AND hd.dol_reportable = true
    `;
  } else if (project_id && contractor_id) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
    `;
  } else if (project_id && severity && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND hd.severity = ${severity} AND t.status = ${status}
    `;
  } else if (project_id && severity) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND hd.severity = ${severity}
    `;
  } else if (project_id && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.status = ${status}
    `;
  } else if (project_id) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.project_id = ${project_id}
    `;
  } else if (contractor_id && severity && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND hd.severity = ${severity} AND t.status = ${status}
    `;
  } else if (contractor_id && severity) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND hd.severity = ${severity}
    `;
  } else if (contractor_id && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.contractor_id = ${contractor_id} AND t.status = ${status}
    `;
  } else if (contractor_id) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.contractor_id = ${contractor_id}
    `;
  } else if (severity && status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND hd.severity = ${severity} AND t.status = ${status}
    `;
  } else if (severity) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND hd.severity = ${severity}
    `;
  } else if (status) {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.status = ${status}
    `;
  } else {
    [countRow] = await sql`
      SELECT COUNT(*)::int as count FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
    `;
  }
  const { count } = countRow;

  // Stats query — only uses project_id and contractor_id filters
  let stats;
  if (project_id && contractor_id) {
    [stats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
        COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
        COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        AND t.project_id = ${project_id} AND t.contractor_id = ${contractor_id}
    `;
  } else if (project_id) {
    [stats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
        COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
        COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.project_id = ${project_id}
    `;
  } else if (contractor_id) {
    [stats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
        COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
        COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.contractor_id = ${contractor_id}
    `;
  } else {
    [stats] = await sql`
      SELECT COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE hd.severity = 'critical')::int as critical,
        COUNT(*) FILTER (WHERE hd.severity = 'major')::int as major,
        COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as open,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true)::int as dol_reportable,
        COUNT(*) FILTER (WHERE hd.dol_reportable = true AND hd.dol_reported = false)::int as dol_pending,
        COUNT(*) FILTER (WHERE hd.corrective_action_required = true AND t.status NOT IN ('closed', 'resolved'))::int as ca_pending
      FROM maintenance_tickets t JOIN hs_ticket_details hd ON hd.ticket_id = t.id
      WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
    `;
  }

  return apiResponse.success(res, {
    incidents,
    total: count,
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
    stats,
  });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const {
    title,
    project_id,
    contractor_id,
    assigned_to,
    incident_type,
    severity = 'moderate',
    incident_date,
    incident_time,
    location,
    description,
    immediate_actions,
    dol_reportable,
    corrective_action_required = false,
    photos,
    injured_persons,
    witnesses,
  } = req.body;

  if (!incident_type) {
    return apiResponse.badRequest(res, 'Incident type is required');
  }

  if (!INCIDENT_TYPE_CONFIG[incident_type as keyof typeof INCIDENT_TYPE_CONFIG]) {
    return apiResponse.badRequest(res, `Invalid incident type: ${incident_type}`);
  }

  // Determine ticket type
  const ticketType = incident_type === 'near_miss'
    ? TicketType.HSE_NEAR_MISS
    : TicketType.HSE_INCIDENT;
  const sourceType = incident_type === 'near_miss' ? 'hse_near_miss' : 'hse_incident';

  // Determine priority and SLA based on severity
  const priorityStr = SEVERITY_TO_PRIORITY[severity as keyof typeof SEVERITY_TO_PRIORITY] || 'normal';
  const priority = PRIORITY_MAP[priorityStr] || TicketPriority.NORMAL;
  const slaHours = SEVERITY_SLA_HOURS[severity as keyof typeof SEVERITY_SLA_HOURS] || 72;

  // Calculate due date
  const dueDate = new Date();
  dueDate.setHours(dueDate.getHours() + slaHours);

  // Check if DoL reportable based on severity
  const isDolReportable =
    dol_reportable !== undefined
      ? dol_reportable
      : severity === 'critical' || severity === 'major';

  // Generate title if not provided
  const incidentConfig = INCIDENT_TYPE_CONFIG[incident_type as keyof typeof INCIDENT_TYPE_CONFIG];
  const autoTitle =
    title || `${incidentConfig?.label || incident_type} - ${location || 'Unknown location'}`;

  // Create maintenance ticket via standard service with HS- prefix
  const ticket = await createTicket({
    uid_prefix: 'HS',
    source: TicketSource.HSE_REPORT,
    source_type: sourceType,
    ticket_type: ticketType,
    title: autoTitle,
    description: description || undefined,
    priority,
    project_id: project_id || undefined,
    assigned_contractor_id: contractor_id || undefined,
    assigned_to: assigned_to || undefined,
  });

  // Create H&S details (linked by ticket.id)
  await sql`
    INSERT INTO hs_ticket_details (
      ticket_id, incident_type, severity, incident_date, incident_time,
      location, description, immediate_actions, dol_reportable,
      corrective_action_required, photos, injured_persons, witnesses
    ) VALUES (
      ${ticket.id},
      ${incident_type},
      ${severity},
      ${incident_date || new Date().toISOString().split('T')[0]},
      ${incident_time || null},
      ${location || null},
      ${description || null},
      ${immediate_actions || null},
      ${isDolReportable},
      ${corrective_action_required},
      ${photos ? JSON.stringify(photos) : '[]'}::jsonb,
      ${injured_persons ? JSON.stringify(injured_persons) : '[]'}::jsonb,
      ${witnesses ? JSON.stringify(witnesses) : '[]'}::jsonb
    )
  `;

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('hs_incident', ${ticket.id}, 'reported', ${JSON.stringify({
      ticket_id: ticket.id,
      ticket_uid: ticket.ticket_uid,
      incident_type,
      severity,
      dol_reportable: isDolReportable,
      project_id,
      contractor_id,
    })}::jsonb)
  `;

  // Get full incident record
  const [incident] = await sql`
    SELECT
      t.*,
      hd.incident_type,
      hd.severity,
      hd.incident_date,
      hd.incident_time,
      hd.location,
      hd.dol_reportable,
      hd.corrective_action_required,
      p.project_name,
      c.company_name as contractor_name
    FROM maintenance_tickets t
    JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    LEFT JOIN projects p ON p.id::text = t.project_id
    LEFT JOIN contractors c ON c.id::text = t.contractor_id
    WHERE t.id = ${ticket.id}
  `;

  return apiResponse.created(res, {
    ...incident,
    type_info: INCIDENT_TYPE_CONFIG[incident_type as keyof typeof INCIDENT_TYPE_CONFIG],
    sla: {
      priority: priorityStr,
      sla_hours: slaHours,
      due_date: dueDate.toISOString(),
    },
  });
}

export default withAuth(handler);
