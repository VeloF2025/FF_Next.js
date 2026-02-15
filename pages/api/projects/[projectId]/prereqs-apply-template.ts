/**
 * API Route: /api/projects/[projectId]/prereqs-apply-template
 *
 * POST: Apply a pre-req template to a project.
 * Creates project_requirements rows from the template.
 *
 * Body: { template_name?: string } (default: 'VF Standard')
 *
 * Response: ApplyTemplateResponse
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { ApplyTemplateResponse } from '@/types/pon-stages.types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success: boolean; data?: ApplyTemplateResponse; error?: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { projectId } = req.query;
  const projectIdStr = Array.isArray(projectId) ? projectId[0] : projectId;
  const { template_name = 'VF Standard' } = req.body as { template_name?: string };

  if (!projectIdStr) {
    return res.status(400).json({ success: false, error: 'Missing projectId' });
  }

  try {
    const client = await pool.connect();
    try {
      // Verify project exists
      const projectResult = await client.query(
        'SELECT id FROM projects WHERE id = $1',
        [projectIdStr]
      );

      if (projectResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Project not found' });
      }

      // Check if template exists
      const templateCheck = await client.query(
        'SELECT COUNT(*)::text as cnt FROM project_prereq_templates WHERE template_name = $1 AND is_active = true',
        [template_name]
      );

      const templateCount = Number(templateCheck.rows[0].cnt);
      if (templateCount === 0) {
        return res.status(404).json({
          success: false,
          error: `Template '${template_name}' not found or has no active items`,
        });
      }

      // Apply template - insert requirements from template
      // Maps template phases to project_requirements stages
      const insertResult = await client.query(
        `INSERT INTO project_requirements (
          project_id, requirement_type, requirement_name, description,
          stage, sort_order, responsible_party, template_id
        )
        SELECT
          $1,
          t.requirement_type,
          t.description,
          t.description,
          CASE t.phase
            WHEN 'site_assignments' THEN 'pipeline'
            WHEN 'prerequisites' THEN 'pipeline'
            WHEN 'site_establishment' THEN 'planning'
            WHEN 'contractor_engagements' THEN 'planning'
            WHEN 'key_milestones' THEN 'execution'
          END,
          t.sort_order,
          t.responsible_party,
          t.id
        FROM project_prereq_templates t
        WHERE t.template_name = $2
          AND t.is_active = true
        ORDER BY t.sort_order
        ON CONFLICT DO NOTHING`,
        [projectIdStr, template_name]
      );

      const itemsCreated = insertResult.rowCount || 0;

      log.info('Template applied', {
        projectId: projectIdStr,
        template_name,
        itemsCreated,
      }, 'PrereqsTemplate');

      const data: ApplyTemplateResponse = {
        project_id: projectIdStr,
        template_name,
        items_created: itemsCreated,
      };

      return res.status(200).json({ success: true, data });
    } finally {
      client.release();
    }
  } catch (error) {
    log.error('Failed to apply template', {
      error, projectId: projectIdStr, template_name,
    }, 'PrereqsTemplate');
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(handler);
