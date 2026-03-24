/**
 * Project Incidents API
 * GET /api/projects/[projectId]/incidents - Get all H&S incidents for a project and its contractors
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface Incident {
  id: string;
  ticket_type: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  hs_incident_type: string | null;
  hs_severity: string | null;
  incident_date: string | null;
  incident_location: string | null;
  is_dol_reportable: boolean;
  source_type: 'project' | 'contractor';
  source_name: string;
  contractor_id: string | null;
  project_id: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId, limit = '50' } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Verify project exists
    const projectResult = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = projectResult[0] as { id: string; project_name: string };
    const limitNum = Math.min(parseInt(String(limit), 10) || 50, 100);

    // Fetch incidents from tickets table where:
    // 1. Project incidents (project_id = projectId AND ticket_type IN H&S types)
    // 2. Contractor incidents (assigned_contractor_id is a contractor assigned to this project)
    const incidentsResult = await sql`
      WITH project_contractors AS (
        SELECT
          c.id::text AS contractor_id,
          c.company_name
        FROM contractor_projects cp
        JOIN contractors c ON c.id = cp.contractor_id
        WHERE cp.project_id = ${projectId}
          AND cp.is_active = true
      )
      SELECT
        t.id,
        t.ticket_type,
        t.title,
        t.status,
        t.priority,
        t.created_at,
        htd.hs_incident_type,
        htd.hs_severity,
        htd.incident_date,
        htd.incident_location,
        COALESCE(htd.is_dol_reportable, false) AS is_dol_reportable,
        CASE
          WHEN t.project_id = ${projectId} THEN 'project'
          ELSE 'contractor'
        END AS source_type,
        CASE
          WHEN t.project_id = ${projectId} THEN ${project.project_name}
          ELSE pc.company_name
        END AS source_name,
        t.assigned_contractor_id AS contractor_id,
        t.project_id
      FROM tickets t
      LEFT JOIN hs_ticket_details htd ON htd.ticket_id = t.id
      LEFT JOIN project_contractors pc ON pc.contractor_id = t.assigned_contractor_id
      WHERE t.ticket_type IN ('hse_incident', 'hse_near_miss')
        AND (
          t.project_id = ${projectId}
          OR t.assigned_contractor_id IN (SELECT contractor_id FROM project_contractors)
        )
      ORDER BY COALESCE(htd.incident_date, t.created_at) DESC
      LIMIT ${limitNum}
    `;

    const incidents: Incident[] = (incidentsResult as Record<string, unknown>[]).map(row => ({
      id: String(row.id),
      ticket_type: String(row.ticket_type),
      title: String(row.title || ''),
      status: String(row.status),
      priority: String(row.priority || 'medium'),
      created_at: String(row.created_at),
      hs_incident_type: row.hs_incident_type ? String(row.hs_incident_type) : null,
      hs_severity: row.hs_severity ? String(row.hs_severity) : null,
      incident_date: row.incident_date ? String(row.incident_date) : null,
      incident_location: row.incident_location ? String(row.incident_location) : null,
      is_dol_reportable: Boolean(row.is_dol_reportable),
      source_type: row.source_type as 'project' | 'contractor',
      source_name: String(row.source_name || 'Unknown'),
      contractor_id: row.contractor_id ? String(row.contractor_id) : null,
      project_id: String(row.project_id),
    }));

    // Calculate summary
    const open = incidents.filter(i => !['closed', 'cancelled', 'resolved'].includes(i.status)).length;
    const closed = incidents.filter(i => ['closed', 'cancelled', 'resolved'].includes(i.status)).length;
    const dolReportable = incidents.filter(i => i.is_dol_reportable).length;

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    incidents.forEach(incident => {
      const type = incident.hs_incident_type || 'unknown';
      const severity = incident.hs_severity || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    });

    return apiResponse.success(res, {
      incidents,
      summary: {
        total: incidents.length,
        open,
        closed,
        by_type: byType,
        by_severity: bySeverity,
        dol_reportable: dolReportable,
      },
    });
  } catch (error) {
    log.error('Failed to fetch project incidents', { projectId, error }, 'incidents-api');
    return apiResponse.databaseError(res, error, 'Failed to fetch project incidents');
  }
}

export default withAuth(withErrorHandler(handler));
