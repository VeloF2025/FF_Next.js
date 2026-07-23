/**
 * Project H&S Audits API
 *
 * GET  /api/health-safety/project/[projectId]/audits - List audits
 * POST /api/health-safety/project/[projectId]/audits - Create new audit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
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
        return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
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
        SELECT a.*, s.name as auditor_name, p.project_name,
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
        SELECT a.*, s.name as auditor_name, p.project_name,
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

  const [{ count }] = (status
    ? await sql`
        SELECT COUNT(*)::int as count FROM hs_project_audits
        WHERE project_id = ${projectId} AND status = ${status}
      `
    : await sql`
        SELECT COUNT(*)::int as count FROM hs_project_audits
        WHERE project_id = ${projectId}
      `) as unknown as [{ count: number }];

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

  // Verify project exists and read the configured audit scope
  const [project] = await sql`
    SELECT p.id, p.project_name, c.template_id
    FROM projects p
    LEFT JOIN hs_project_config c ON c.project_id = p.id
    WHERE p.id = ${projectId}
  `;

  if (!project) {
    return apiResponse.notFound(res, 'Project', projectId);
  }

  // Audit scope (D1): a configured template_id restricts the audit to that
  // template (even if since deactivated — an explicit pin wins); otherwise
  // the audit covers ALL active templates that have items. Count seedable
  // items BEFORE creating the audit — an empty wizard must never be created.
  const countRows = project.template_id
    ? await sql`
        SELECT COUNT(*)::int AS count
        FROM hs_checklist_items
        WHERE template_id = ${project.template_id}
      `
    : await sql`
        SELECT COUNT(*)::int AS count
        FROM hs_checklist_items i
        JOIN hs_checklist_templates t ON t.id = i.template_id
        WHERE t.is_active = true
      `;
  const itemCount = (countRows[0] as { count: number }).count;

  if (itemCount === 0) {
    return apiResponse.badRequest(
      res,
      'No checklist items available for this audit scope. Add items to the configured template, or activate templates that have items, before starting an audit.'
    );
  }

  // Create audit
  const auditRows = await sql`
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
  const audit = auditRows[0]!;

  // Seed responses in one statement. RETURNING makes the row count
  // authoritative — the pre-count above can go stale if templates/items
  // change between the two queries, and an INSERT from an empty SELECT does
  // not throw. Zero seeded rows is treated exactly like a seed failure: the
  // audit is removed so no empty audit is left behind (no shim transactions).
  let seededCount = 0;
  try {
    const seeded = project.template_id
      ? await sql`
          INSERT INTO hs_audit_responses (audit_id, checklist_item_id, response)
          SELECT ${audit.id}, i.id, 'not_checked'
          FROM hs_checklist_items i
          WHERE i.template_id = ${project.template_id}
          RETURNING id
        `
      : await sql`
          INSERT INTO hs_audit_responses (audit_id, checklist_item_id, response)
          SELECT ${audit.id}, i.id, 'not_checked'
          FROM hs_checklist_items i
          JOIN hs_checklist_templates t ON t.id = i.template_id
          WHERE t.is_active = true
          RETURNING id
        `;
    seededCount = seeded.length;
    if (seededCount === 0) {
      throw new Error('Audit scope produced zero checklist items at seed time');
    }
  } catch (seedError) {
    log.error('[H&S Project Audits API] Response seeding failed — rolling back audit', {
      auditId: audit.id,
      error: seedError,
    });
    try {
      await sql`DELETE FROM hs_audit_responses WHERE audit_id = ${audit.id}`;
      await sql`DELETE FROM hs_project_audits WHERE id = ${audit.id}`;
    } catch (cleanupError) {
      log.error('[H&S Project Audits API] Failed to clean up audit after seed failure', {
        auditId: audit.id,
        cleanupError,
      });
    }
    return apiResponse.internalError(res, seedError);
  }

  await logHsActivity({
    activityType: 'audit_created',
    entityType: 'project_audit',
    entityId: audit.id as string,
    description: 'New audit started',
    metadata: {
      project_id: projectId,
      project_name: project.project_name,
      audit_type,
      seeded_items: seededCount,
      scope: project.template_id ? 'template' : 'all_active_templates',
    },
    user: getAuthUser(req),
  });

  return apiResponse.created(res, {
    ...audit,
    project_name: project.project_name,
    seeded_items: seededCount,
  });
}

export default withAuth(handler);
