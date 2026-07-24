/**
 * H&S Incident Detail API
 *
 * GET /api/health-safety/incidents/[incidentId] - Get a single incident
 * (maintenance ticket + hs_ticket_details) with project/contractor context.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

import { log } from '@/lib/logger';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { incidentId } = req.query;

  if (!incidentId || typeof incidentId !== 'string') {
    return apiResponse.badRequest(res, 'incidentId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(incidentId, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
    }
  } catch (error) {
    log.error('[H&S Incident Detail API] Error', { error, incidentId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(incidentId: string, res: NextApiResponse) {
  const [incident] = await sql`
    SELECT t.id, t.ticket_uid, t.title, t.description AS ticket_description, t.status, t.priority,
           t.source_type, t.created_at, t.updated_at, t.project_id, t.contractor_id,
           hd.incident_type, hd.severity, hd.incident_date, hd.incident_time, hd.location,
           hd.description, hd.immediate_actions, hd.dol_reportable, hd.dol_reported,
           hd.corrective_action_required, hd.injured_persons, hd.witnesses, hd.photos,
           p.project_name, c.company_name AS contractor_name
    FROM maintenance_tickets t
    JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    LEFT JOIN projects p ON p.id::text = t.project_id
    LEFT JOIN contractors c ON c.id = t.contractor_id
    WHERE t.id = ${incidentId}
  `;

  if (!incident) {
    return apiResponse.notFound(res, 'Incident', incidentId);
  }

  return apiResponse.success(res, incident);
}

export default withHsPermission(handler);
