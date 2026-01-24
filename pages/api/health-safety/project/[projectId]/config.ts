/**
 * Project H&S Configuration API
 *
 * GET  /api/health-safety/project/[projectId]/config - Get project H&S config
 * PUT  /api/health-safety/project/[projectId]/config - Update/create config
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

import { withAuth } from '@/lib/auth';
const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(projectId, res);
      case 'PUT':
        return handlePut(projectId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    console.error('[H&S Project Config API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(projectId: string, res: NextApiResponse) {
  // Get config with template info
  const [config] = await sql`
    SELECT
      c.*,
      t.name as template_name,
      t.category as template_category,
      p.project_name
    FROM hs_project_config c
    LEFT JOIN hs_checklist_templates t ON t.id = c.template_id
    LEFT JOIN projects p ON p.id = c.project_id
    WHERE c.project_id = ${projectId}
  `;

  if (!config) {
    // Return empty config with project info
    const [project] = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    `;

    if (!project) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    return apiResponse.success(res, {
      project_id: projectId,
      project_name: project.project_name,
      configured: false,
      config: null,
    });
  }

  // Get recent audit stats
  const [auditStats] = await sql`
    SELECT
      COUNT(*)::int as total_audits,
      COUNT(*) FILTER (WHERE status = 'completed')::int as completed_audits,
      AVG(overall_score)::int as average_score,
      MAX(audit_date) as last_audit_date
    FROM hs_project_audits
    WHERE project_id = ${projectId}
  `;

  return apiResponse.success(res, {
    project_id: projectId,
    project_name: config.project_name,
    configured: true,
    config,
    audit_stats: auditStats,
  });
}

async function handlePut(projectId: string, req: NextApiRequest, res: NextApiResponse) {
  const {
    template_id,
    audit_frequency = 'weekly',
    custom_frequency_days,
    min_score_threshold = 80,
    requires_daily_briefing = true,
    height_work_permitted = false,
    hot_work_permitted = false,
    confined_space_work = false,
    excavation_work = false,
    notes,
  } = req.body;

  // Verify project exists
  const [project] = await sql`
    SELECT id, project_name FROM projects WHERE id = ${projectId}
  `;

  if (!project) {
    return apiResponse.notFound(res, 'Project', projectId);
  }

  // Calculate next audit due date
  const frequencyDays =
    audit_frequency === 'custom'
      ? custom_frequency_days || 7
      : { daily: 1, weekly: 7, fortnightly: 14, monthly: 30 }[audit_frequency] || 7;

  const nextAuditDue = new Date();
  nextAuditDue.setDate(nextAuditDue.getDate() + frequencyDays);

  // Upsert config
  const [config] = await sql`
    INSERT INTO hs_project_config (
      project_id, template_id, audit_frequency, custom_frequency_days,
      next_audit_due, min_score_threshold, requires_daily_briefing,
      height_work_permitted, hot_work_permitted, confined_space_work,
      excavation_work, notes
    ) VALUES (
      ${projectId}, ${template_id || null}, ${audit_frequency}, ${custom_frequency_days || null},
      ${nextAuditDue.toISOString().split('T')[0]}, ${min_score_threshold}, ${requires_daily_briefing},
      ${height_work_permitted}, ${hot_work_permitted}, ${confined_space_work},
      ${excavation_work}, ${notes || null}
    )
    ON CONFLICT (project_id)
    DO UPDATE SET
      template_id = COALESCE(${template_id}, hs_project_config.template_id),
      audit_frequency = ${audit_frequency},
      custom_frequency_days = ${custom_frequency_days || null},
      next_audit_due = ${nextAuditDue.toISOString().split('T')[0]},
      min_score_threshold = ${min_score_threshold},
      requires_daily_briefing = ${requires_daily_briefing},
      height_work_permitted = ${height_work_permitted},
      hot_work_permitted = ${hot_work_permitted},
      confined_space_work = ${confined_space_work},
      excavation_work = ${excavation_work},
      notes = COALESCE(${notes}, hs_project_config.notes),
      updated_at = NOW()
    RETURNING *
  `;

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('project_config', ${config.id}, 'updated', ${JSON.stringify({
      project_id: projectId,
      project_name: project.project_name,
      audit_frequency,
    })}::jsonb)
  `;

  return apiResponse.success(res, {
    ...config,
    project_name: project.project_name,
  });
}

export default withAuth(handler);
