/**
 * CAPA Detail API
 *
 * GET  /api/health-safety/capa/[capaId] - Get CAPA with comments
 * PUT  /api/health-safety/capa/[capaId] - Update CAPA (status, details, verify)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { CAPA_STATUS_TRANSITIONS } from '@/modules/health-safety/types/capa.types';
import type { CAPAStatus } from '@/modules/health-safety/types/capa.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { capaId } = req.query;
  if (!capaId || typeof capaId !== 'string') {
    return apiResponse.badRequest(res, 'capaId is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(capaId, res);
      case 'PUT':
        return handlePut(capaId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT']);
    }
  } catch (error) {
    log.error('[CAPA Detail API] Error', { error, capaId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(capaId: string, res: NextApiResponse) {
  const [capa] = await sql`
    SELECT ca.*, p.project_name, c.company_name as contractor_name,
           u.name as assigned_to_name, cr.name as created_by_name,
           v.name as verified_by_name, co.name as completed_by_name,
           CASE WHEN ca.due_date < CURRENT_DATE AND ca.status NOT IN ('closed') THEN true ELSE false END as is_overdue
    FROM hs_corrective_actions ca
    LEFT JOIN projects p ON p.id = ca.project_id
    LEFT JOIN contractors c ON c.id = ca.contractor_id
    LEFT JOIN users u ON u.id = ca.assigned_to
    LEFT JOIN users cr ON cr.id = ca.created_by
    LEFT JOIN users v ON v.id = ca.verified_by
    LEFT JOIN users co ON co.id = ca.completed_by
    WHERE ca.id = ${capaId}
  `;

  if (!capa) {
    return apiResponse.notFound(res, 'CAPA', capaId);
  }

  // Get comments
  const comments = await sql`
    SELECT cc.*, u.name as author_name
    FROM hs_capa_comments cc
    LEFT JOIN users u ON u.id = cc.author_id
    WHERE cc.capa_id = ${capaId}
    ORDER BY cc.created_at ASC
  `;

  return apiResponse.success(res, { capa, comments });
}

async function handlePut(capaId: string, req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as any).userId || null;
  const {
    status,
    title,
    description,
    severity,
    assigned_to,
    due_date,
    completion_notes,
    verification_notes,
    verification_outcome,
    root_cause_method,
    root_cause_analysis,
    preventive_actions,
    evidence_photos,
    comment,
  } = req.body;

  // Fetch current CAPA
  const [current] = await sql`
    SELECT * FROM hs_corrective_actions WHERE id = ${capaId}
  `;
  if (!current) {
    return apiResponse.notFound(res, 'CAPA', capaId);
  }

  // Validate status transition
  if (status && status !== current.status) {
    const allowed = CAPA_STATUS_TRANSITIONS[current.status as CAPAStatus] || [];
    if (!allowed.includes(status as CAPAStatus)) {
      return apiResponse.badRequest(
        res,
        `Cannot transition from '${current.status}' to '${status}'. Allowed: ${allowed.join(', ')}`
      );
    }
  }

  // Build update
  const newStatus = status || current.status;
  const now = new Date().toISOString();

  const [updated] = await sql`
    UPDATE hs_corrective_actions SET
      status = ${newStatus},
      title = ${title || current.title},
      description = ${description !== undefined ? description : current.description},
      severity = ${severity || current.severity},
      assigned_to = ${assigned_to !== undefined ? assigned_to : current.assigned_to},
      assigned_at = ${assigned_to && !current.assigned_to ? now : current.assigned_at},
      due_date = ${due_date || current.due_date},
      completed_at = ${newStatus === 'verification' && !current.completed_at ? now : current.completed_at},
      completed_by = ${newStatus === 'verification' && !current.completed_by ? userId : current.completed_by},
      completion_notes = ${completion_notes !== undefined ? completion_notes : current.completion_notes},
      verified_by = ${newStatus === 'closed' && verification_outcome === 'accepted' ? userId : current.verified_by},
      verified_at = ${newStatus === 'closed' && verification_outcome === 'accepted' ? now : current.verified_at},
      verification_notes = ${verification_notes !== undefined ? verification_notes : current.verification_notes},
      verification_outcome = ${verification_outcome || current.verification_outcome},
      root_cause_method = ${root_cause_method || current.root_cause_method},
      root_cause_analysis = ${root_cause_analysis ? JSON.stringify(root_cause_analysis) + '::jsonb' : current.root_cause_analysis},
      preventive_actions = ${preventive_actions !== undefined ? preventive_actions : current.preventive_actions},
      evidence_photos = ${evidence_photos ? JSON.stringify(evidence_photos) + '::jsonb' : current.evidence_photos}
    WHERE id = ${capaId}
    RETURNING *
  `;

  // Add comment if provided
  if (comment) {
    await sql`
      INSERT INTO hs_capa_comments (capa_id, author_id, comment)
      VALUES (${capaId}, ${userId}, ${comment})
    `;
  }

  // Auto-add status change comment
  if (status && status !== current.status) {
    await sql`
      INSERT INTO hs_capa_comments (capa_id, author_id, comment)
      VALUES (${capaId}, ${userId}, ${'Status changed from ' + current.status + ' to ' + status})
    `;

    // Log activity
    await sql`
      INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details, previous_values)
      VALUES ('capa', ${capaId}, 'status_changed', ${userId},
        ${JSON.stringify({ new_status: status, previous_status: current.status })}::jsonb,
        ${JSON.stringify({ status: current.status })}::jsonb)
    `;
  }

  return apiResponse.success(res, updated);
}

export default withAuth(handler);
