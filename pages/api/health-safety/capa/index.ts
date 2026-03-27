/**
 * CAPA API - List and Create
 *
 * GET  /api/health-safety/capa - List CAPAs with filters
 * POST /api/health-safety/capa - Create new CAPA
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { CAPAInput } from '@/modules/health-safety/types/capa.types';
import { CAPA_SEVERITY_CONFIG } from '@/modules/health-safety/types/capa.types';

const sql = neon(process.env.DATABASE_URL!);

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
    log.error('[CAPA API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const {
    project_id,
    contractor_id,
    status,
    severity,
    source_type,
    assigned_to,
    overdue_only,
    limit = '50',
    offset = '0',
  } = req.query;

  // Build query based on filters — explicit branches for Neon
  let capas;
  const lim = parseInt(limit as string);
  const off = parseInt(offset as string);

  if (project_id && status) {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      WHERE ca.project_id = ${project_id} AND ca.status = ${status}
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (project_id) {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      WHERE ca.project_id = ${project_id}
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (contractor_id && status) {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      WHERE ca.contractor_id = ${contractor_id} AND ca.status = ${status}
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (contractor_id) {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      WHERE ca.contractor_id = ${contractor_id}
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (status) {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      WHERE ca.status = ${status}
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (overdue_only === 'true') {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             true as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      WHERE ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed')
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else {
    capas = await sql`
      SELECT ca.*, p.project_name, c.company_name as contractor_name,
             u.name as assigned_to_name, cr.name as created_by_name,
             CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
      FROM hs_corrective_actions ca
      LEFT JOIN projects p ON p.id = ca.project_id
      LEFT JOIN contractors c ON c.id = ca.contractor_id
      LEFT JOIN users u ON u.id = ca.assigned_to
      LEFT JOIN users cr ON cr.id = ca.created_by
      ORDER BY ca.due_date ASC, ca.severity DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  }

  // Stats
  const [stats] = await sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE status = 'open')::int as open,
      COUNT(*) FILTER (WHERE status = 'in_progress')::int as in_progress,
      COUNT(*) FILTER (WHERE status = 'verification')::int as verification,
      COUNT(*) FILTER (WHERE status = 'closed')::int as closed,
      COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('closed'))::int as overdue
    FROM hs_corrective_actions
  `;

  return apiResponse.success(res, { capas, stats });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as CAPAInput;

  if (!body.title || !body.source_type || !body.due_date) {
    return apiResponse.badRequest(res, 'title, source_type, and due_date are required');
  }

  // Default due date based on severity if not provided
  const severity = body.severity || 'medium';
  const dueDate = body.due_date || (() => {
    const d = new Date();
    d.setDate(d.getDate() + CAPA_SEVERITY_CONFIG[severity].defaultDueDays);
    return d.toISOString().split('T')[0];
  })();

  const userId = (req as any).userId || null;

  const [capa] = await sql`
    INSERT INTO hs_corrective_actions (
      source_type, source_id, project_id, contractor_id,
      title, description, severity, due_date,
      assigned_to, assigned_at,
      root_cause_method, root_cause_analysis,
      preventive_actions, evidence_photos,
      created_by
    ) VALUES (
      ${body.source_type},
      ${body.source_id || null},
      ${body.project_id || null},
      ${body.contractor_id || null},
      ${body.title},
      ${body.description || null},
      ${severity},
      ${dueDate},
      ${body.assigned_to || null},
      ${body.assigned_to ? new Date().toISOString() : null},
      ${body.root_cause_method || null},
      ${JSON.stringify(body.root_cause_analysis || [])}::jsonb,
      ${body.preventive_actions || null},
      ${JSON.stringify(body.evidence_photos || [])}::jsonb,
      ${userId}
    )
    RETURNING *
  `;

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details)
    VALUES ('capa', ${capa.id}, 'created', ${userId}, ${JSON.stringify({
      title: body.title,
      source_type: body.source_type,
      severity,
      project_id: body.project_id,
      contractor_id: body.contractor_id,
    })}::jsonb)
  `;

  return apiResponse.created(res, capa);
}

export default withAuth(handler);
