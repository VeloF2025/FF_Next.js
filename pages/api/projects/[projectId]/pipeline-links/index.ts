/**
 * Project Pipeline Links API
 * GET /api/projects/[projectId]/pipeline-links - List all linked pipeline projects
 * POST /api/projects/[projectId]/pipeline-links - Add new link
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

export interface PipelineLink {
  id: string;
  project_id: string;
  pipeline_project_id: string;
  is_primary: boolean;
  link_type: 'transition' | 'manual';
  link_order: number;
  linked_at: string;
  linked_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  pipeline_project_name?: string;
  pipeline_status?: string;
  pipeline_area?: string;
  pipeline_municipality?: string;
  approval_count?: number;
  approved_count?: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(res, projectId);
    case 'POST':
      return handlePost(req as AuthenticatedNextApiRequest, res, projectId);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

/**
 * GET /api/projects/[projectId]/pipeline-links
 * List all linked pipeline projects for a project
 */
async function handleGet(res: NextApiResponse, projectId: string) {
  try {
    // Verify project exists
    const projectResult = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Fetch all links with pipeline project details
    const links = await sql`
      SELECT
        ppl.*,
        pp.project_name as pipeline_project_name,
        pp.pipeline_status,
        pp.area as pipeline_area,
        pp.municipality as pipeline_municipality,
        (
          SELECT COUNT(*)
          FROM pipeline_project_approvals ppa
          JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
          WHERE ppa.pipeline_project_id = pp.id
            AND pat.category = 'wayleave'
            AND ppa.is_required = true
        ) as approval_count,
        (
          SELECT COUNT(*)
          FROM pipeline_project_approvals ppa
          JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
          WHERE ppa.pipeline_project_id = pp.id
            AND pat.category = 'wayleave'
            AND ppa.is_required = true
            AND ppa.status IN ('approved', 'conditionally_approved', 'renewed')
        ) as approved_count
      FROM project_pipeline_links ppl
      JOIN pipeline_projects pp ON pp.id = ppl.pipeline_project_id
      WHERE ppl.project_id = ${projectId}
      ORDER BY ppl.is_primary DESC, ppl.link_order ASC, ppl.linked_at ASC
    `;

    return apiResponse.success(res, {
      links,
      primary_link_id: links.find((l: PipelineLink) => l.is_primary)?.id || null,
      count: links.length,
    });
  } catch (error) {
    log.error('Failed to fetch pipeline links', { projectId, error }, 'pipeline-links-api');
    return apiResponse.databaseError(res, error, 'Failed to fetch pipeline links');
  }
}

/**
 * POST /api/projects/[projectId]/pipeline-links
 * Add a new pipeline link to the project
 */
async function handlePost(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  try {
    const userId = req.user?.id;
    const { pipeline_project_id, is_primary, notes } = req.body;

    // Look up staff ID from user ID (linked_by references staff table)
    let staffId: string | null = null;
    if (userId) {
      const staffResult = await sql`
        SELECT id FROM staff WHERE user_id = ${userId} LIMIT 1
      `;
      staffId = staffResult.length > 0 ? (staffResult[0] as { id: string }).id : null;
    }

    if (!pipeline_project_id) {
      return apiResponse.badRequest(res, 'Pipeline project ID is required');
    }

    // Verify project exists
    const projectResult = await sql`
      SELECT id, project_name FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Verify pipeline project exists
    const pipelineResult = await sql`
      SELECT id, project_name, pipeline_status
      FROM pipeline_projects
      WHERE id = ${pipeline_project_id} AND is_deleted = false
    `;

    if (pipelineResult.length === 0) {
      return apiResponse.notFound(res, 'Pipeline project', pipeline_project_id);
    }

    // Check if link already exists
    const existingLink = await sql`
      SELECT id FROM project_pipeline_links
      WHERE project_id = ${projectId} AND pipeline_project_id = ${pipeline_project_id}
    `;

    if (existingLink.length > 0) {
      return apiResponse.conflict(res, 'This pipeline project is already linked');
    }

    // If setting as primary, unset any existing primary
    if (is_primary) {
      await sql`
        UPDATE project_pipeline_links
        SET is_primary = false, updated_at = NOW()
        WHERE project_id = ${projectId} AND is_primary = true
      `;
    }

    // Get max link_order for this project
    const orderResult = await sql`
      SELECT COALESCE(MAX(link_order), -1) + 1 as next_order
      FROM project_pipeline_links
      WHERE project_id = ${projectId}
    `;
    const linkOrder = (orderResult[0] as { next_order: number }).next_order;

    // Check if this is the first link (should be primary by default)
    const existingLinks = await sql`
      SELECT COUNT(*) as count FROM project_pipeline_links WHERE project_id = ${projectId}
    `;
    const isFirstLink = (existingLinks[0] as { count: string }).count === '0';
    const shouldBePrimary = is_primary || isFirstLink;

    // Create the link
    const result = await sql`
      INSERT INTO project_pipeline_links (
        project_id,
        pipeline_project_id,
        is_primary,
        link_type,
        link_order,
        linked_by,
        notes
      ) VALUES (
        ${projectId},
        ${pipeline_project_id},
        ${shouldBePrimary},
        'manual',
        ${linkOrder},
        ${staffId},
        ${notes || null}
      )
      RETURNING *
    `;

    // Also update the legacy column if this is primary (backward compatibility)
    if (shouldBePrimary) {
      await sql`
        UPDATE projects
        SET pipeline_project_id = ${pipeline_project_id}
        WHERE id = ${projectId}
      `;
    }

    // Fetch with joined pipeline details
    const link = await sql`
      SELECT
        ppl.*,
        pp.project_name as pipeline_project_name,
        pp.pipeline_status,
        pp.area as pipeline_area,
        pp.municipality as pipeline_municipality
      FROM project_pipeline_links ppl
      JOIN pipeline_projects pp ON pp.id = ppl.pipeline_project_id
      WHERE ppl.id = ${(result[0] as { id: string }).id}
    `;

    log.info('Created pipeline link', {
      projectId,
      pipelineProjectId: pipeline_project_id,
      linkId: (result[0] as { id: string }).id,
      isPrimary: shouldBePrimary,
    }, 'pipeline-links-api');

    return apiResponse.created(res, link[0]);
  } catch (error) {
    log.error('Failed to create pipeline link', { projectId, error }, 'pipeline-links-api');
    return apiResponse.databaseError(res, error, 'Failed to create pipeline link');
  }
}

export default withAuth(withErrorHandler(handler));
