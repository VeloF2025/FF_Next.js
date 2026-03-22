/**
 * Project H&S Audits API
 *
 * GET  /api/health-safety/project/[projectId]/audits - List audits
 * POST /api/health-safety/project/[projectId]/audits - Create new audit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(projectId, req, res);
      case 'POST':
        return handlePost(projectId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    log.error('[H&S Project Audits API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(projectId: string, req: NextApiRequest, res: NextApiResponse) {
  const { status, limit = '20', offset = '0' } = req.query;

  // Explicit branches to avoid conditional SQL fragments (Neon rule)
  const audits = status
    ? await sql`
        SELECT a.*, s.full_name as auditor_name, p.project_name,
          (SELECT json_build_object(
            'total', COUNT(*)::int,
            'passed', COUNT(*) FILTER (WHERE response = 'pass')::int,
            'failed', COUNT(*) FILTER (WHERE response = 'fail')::int,
            'na', COUNT(*) FILTER (WHERE response = 'na')::int
          ) FROM hs_audit_responses WHERE audit_id = a.id) as response_summary
        FROM hs_project_audits a
        LEFT JOIN staff s ON s.id = a.auditor_id
        LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.project_id = ${projectId} AND a.status = ${status}
        ORDER BY a.audit_date DESC, a.created_at DESC
        LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
      `
    : await sql`
        SELECT a.*, s.full_name as auditor_name, p.project_name,
          (SELECT json_build_object(
            'total', COUNT(*)::int,
            'passed', COUNT(*) FILTER (WHERE response = 'pass')::int,
            'failed', COUNT(*) FILTER (WHERE response = 'fail')::int,
            'na', COUNT(*) FILTER (WHERE response = 'na')::int
          ) FROM hs_audit_responses WHERE audit_id = a.id) as response_summary
        FROM hs_project_audits a
        LEFT JOIN staff s ON s.id = a.auditor_id
        LEFT JOIN projects p ON p.id = a.project_id
        WHERE a.project_id = ${projectId}
        ORDER BY a.audit_date DESC, a.created_at DESC
        LIMIT ${parseInt(limit as string)} OFFSET ${parseInt(offset as string)}
      `;

  const [{ count }] = status
    ? await sql`
        SELECT COUNT(*)::int as count FROM hs_project_audits
        WHERE project_id = ${projectId} AND status = ${status}
      `
    : await sql`
        SELECT COUNT(*)::int as count FROM hs_project_audits
        WHERE project_id = ${projectId}
      `;

  return apiResponse.success(res, {
    audits,
    total: count,
    limit: parseInt(limit as string),
    offset: parseInt(offset as string),
  });
}

async function handlePost(projectId: string, req: NextApiRequest, res: NextApiResponse) {
  const {
    auditor_id,
    audit_type = 'routine',
    audit_date,
    notes,
    weather_conditions,
    site_personnel_count,
  } = req.body;

  // Verify project exists and has H&S config
  const [project] = await sql`
    SELECT p.id, p.project_name, c.template_id
    FROM projects p
    LEFT JOIN hs_project_config c ON c.project_id = p.id
    WHERE p.id = ${projectId}
  `;

  if (!project) {
    return apiResponse.notFound(res, 'Project', projectId);
  }

  // Create audit
  const [audit] = await sql`
    INSERT INTO hs_project_audits (
      project_id, auditor_id, audit_type, audit_date,
      notes, weather_conditions, site_personnel_count, status
    ) VALUES (
      ${projectId},
      ${auditor_id || null},
      ${audit_type},
      ${audit_date || new Date().toISOString().split('T')[0]},
      ${notes || null},
      ${weather_conditions || null},
      ${site_personnel_count || null},
      'in_progress'
    )
    RETURNING *
  `;

  // If template exists, pre-populate responses with 'not_checked'
  if (project.template_id) {
    const items = await sql`
      SELECT id, category, severity, is_mandatory
      FROM hs_checklist_items
      WHERE template_id = ${project.template_id}
      ORDER BY sort_order
    `;

    for (const item of items) {
      await sql`
        INSERT INTO hs_audit_responses (audit_id, checklist_item_id, response)
        VALUES (${audit.id}, ${item.id}, 'not_checked')
      `;
    }
  }

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details)
    VALUES ('project_audit', ${audit.id}, 'created', ${auditor_id || null}, ${JSON.stringify({
      project_id: projectId,
      project_name: project.project_name,
      audit_type,
    })}::jsonb)
  `;

  return apiResponse.created(res, {
    ...audit,
    project_name: project.project_name,
  });
}

export default withAuth(handler);
