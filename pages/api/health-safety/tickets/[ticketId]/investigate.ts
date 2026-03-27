/**
 * H&S Investigation API
 *
 * POST /api/health-safety/tickets/[ticketId]/investigate - Start or update investigation
 * PUT  /api/health-safety/tickets/[ticketId]/investigate - Complete investigation + create CAPAs
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { ticketId } = req.query;
  if (!ticketId || typeof ticketId !== 'string') {
    return apiResponse.badRequest(res, 'ticketId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(ticketId, res);
      case 'POST':
        return handlePost(ticketId, req, res);
      case 'PUT':
        return handlePut(ticketId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT']);
    }
  } catch (error) {
    log.error('[Investigation API] Error', { error, ticketId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(ticketId: string, res: NextApiResponse) {
  const [details] = await sql`
    SELECT hd.*,
           CONCAT(u.first_name, ' ', u.last_name) as investigator_name
    FROM hs_ticket_details hd
    LEFT JOIN users u ON u.id = hd.investigated_by
    WHERE hd.ticket_id = ${ticketId}
  `;

  if (!details) {
    return apiResponse.notFound(res, 'H&S ticket details', ticketId);
  }

  // Get linked CAPAs
  const capas = await sql`
    SELECT id, title, severity, status, due_date, created_at
    FROM hs_corrective_actions
    WHERE source_type = 'incident' AND source_id = ${ticketId}
    ORDER BY created_at DESC
  `;

  return apiResponse.success(res, { details, capas });
}

// POST: Assign investigator / start investigation
async function handlePost(ticketId: string, req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as any).userId || null;
  const { investigated_by } = req.body;

  const assignee = investigated_by || userId;

  const [updated] = await sql`
    UPDATE hs_ticket_details SET
      investigation_status = 'in_progress',
      investigated_by = ${assignee},
      investigation_started_at = now(),
      updated_at = now()
    WHERE ticket_id = ${ticketId}
    RETURNING *
  `;

  if (!updated) {
    return apiResponse.notFound(res, 'H&S ticket details', ticketId);
  }

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details)
    VALUES ('hs_incident', ${ticketId}, 'investigation_started', ${userId},
      ${JSON.stringify({ investigated_by: assignee })}::jsonb)
  `;

  return apiResponse.success(res, updated);
}

// PUT: Update investigation findings, complete, and optionally create CAPAs
async function handlePut(ticketId: string, req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as any).userId || null;
  const {
    root_cause,
    root_cause_method,
    root_cause_analysis,
    contributing_factors,
    investigation_findings,
    investigation_recommendations,
    complete,
    capa_items,
  } = req.body;

  const now = new Date().toISOString();

  const [updated] = await sql`
    UPDATE hs_ticket_details SET
      root_cause = COALESCE(${root_cause || null}, root_cause),
      root_cause_method = COALESCE(${root_cause_method || null}, root_cause_method),
      root_cause_analysis = COALESCE(${root_cause_analysis ? JSON.stringify(root_cause_analysis) : null}::jsonb, root_cause_analysis),
      contributing_factors = COALESCE(${contributing_factors ? JSON.stringify(contributing_factors) : null}::jsonb, contributing_factors),
      investigation_findings = COALESCE(${investigation_findings || null}, investigation_findings),
      investigation_recommendations = COALESCE(${investigation_recommendations || null}, investigation_recommendations),
      investigation_status = ${complete ? 'completed' : 'in_progress'},
      investigation_completed_at = ${complete ? now : null},
      updated_at = now()
    WHERE ticket_id = ${ticketId}
    RETURNING *
  `;

  if (!updated) {
    return apiResponse.notFound(res, 'H&S ticket details', ticketId);
  }

  // Create CAPAs from investigation recommendations
  const createdCapas = [];
  if (capa_items && Array.isArray(capa_items)) {
    // Get project_id from the maintenance ticket
    const [ticket] = await sql`
      SELECT project_id, contractor_id FROM maintenance_tickets WHERE id = ${ticketId}
    `;

    for (const item of capa_items) {
      const [capa] = await sql`
        INSERT INTO hs_corrective_actions (
          source_type, source_id, project_id, contractor_id,
          title, description, severity, due_date,
          assigned_to, assigned_at, created_by
        ) VALUES (
          'incident', ${ticketId},
          ${ticket?.project_id || null}, ${ticket?.contractor_id || null},
          ${item.title}, ${item.description || null},
          ${item.severity || 'medium'},
          ${item.due_date},
          ${item.assigned_to || null},
          ${item.assigned_to ? now : null},
          ${userId}
        )
        RETURNING id, title, severity, status, due_date
      `;
      createdCapas.push(capa);
    }
  }

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details)
    VALUES ('hs_incident', ${ticketId},
      ${complete ? 'investigation_completed' : 'investigation_updated'}, ${userId},
      ${JSON.stringify({
        root_cause_method,
        capas_created: createdCapas.length,
      })}::jsonb)
  `;

  return apiResponse.success(res, {
    investigation: updated,
    capas_created: createdCapas,
  });
}

export default withAuth(handler);
