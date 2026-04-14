/**
 * H&S Incidents API
 *
 * GET /api/health-safety/incidents - List all H&S incidents
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { project_id, severity, status, limit = '50' } = req.query;

    // Check if maintenance_tickets table exists
    const ticketsTableExists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'maintenance_tickets'
      ) as exists
    `;

    if (!ticketsTableExists[0]?.exists) {
      return apiResponse.success(res, []);
    }

    // Get incidents — explicit branches to avoid conditional SQL fragments (Neon rule)
    let incidents;
    if (project_id && severity && status) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
          AND t.project_id = ${project_id} AND hd.severity = ${severity} AND t.status = ${status}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else if (project_id && severity) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
          AND t.project_id = ${project_id} AND hd.severity = ${severity}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else if (project_id && status) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
          AND t.project_id = ${project_id} AND t.status = ${status}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else if (project_id) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.project_id = ${project_id}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else if (severity && status) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
          AND hd.severity = ${severity} AND t.status = ${status}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else if (severity) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND hd.severity = ${severity}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else if (status) {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss') AND t.status = ${status}
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    } else {
      incidents = await sql`
        SELECT t.id, t.ticket_number, t.title, t.description, t.status, t.priority, t.source_type,
               t.project_id, p.project_name, t.contractor_id, c.company_name as contractor_name,
               t.created_at, t.updated_at, t.resolved_at, t.assigned_to, t.location,
               hd.severity, hd.dol_reportable, hd.dol_reported, hd.corrective_action_required,
               hd.root_cause, hd.investigation_notes, u.first_name || ' ' || u.last_name as reported_by
        FROM maintenance_tickets t
        LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
        LEFT JOIN projects p ON p.id = t.project_id
        LEFT JOIN contractors c ON c.id = t.contractor_id
        LEFT JOIN users u ON u.id = t.assigned_to
        WHERE t.source_type IN ('hse_incident', 'hse_near_miss')
        ORDER BY t.created_at DESC LIMIT ${parseInt(limit as string, 10)}
      `;
    }

    // Map to expected format
    const mapped = incidents.map((i: any) => ({
      id: i.id,
      ticket_number: i.ticket_number,
      title: i.title,
      description: i.description,
      status: i.status,
      severity: i.severity || 'minor',
      priority: i.priority,
      source_type: i.source_type,
      project_id: i.project_id,
      project_name: i.project_name,
      contractor_id: i.contractor_id,
      contractor_name: i.contractor_name,
      location: i.location,
      incident_date: i.created_at,
      reported_by: i.reported_by,
      dol_reportable: i.dol_reportable,
      dol_reported: i.dol_reported,
      corrective_action_required: i.corrective_action_required,
      root_cause: i.root_cause,
      investigation_notes: i.investigation_notes,
      created_at: i.created_at,
      updated_at: i.updated_at,
      resolved_at: i.resolved_at,
    }));

    return apiResponse.success(res, mapped);
  } catch (error) {
    log.error('[H&S Incidents API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
