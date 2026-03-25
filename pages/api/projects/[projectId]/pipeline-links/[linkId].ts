/**
 * Project Pipeline Link API
 * GET /api/projects/[projectId]/pipeline-links/[linkId] - Get single link details
 * PATCH /api/projects/[projectId]/pipeline-links/[linkId] - Update link
 * DELETE /api/projects/[projectId]/pipeline-links/[linkId] - Remove link
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId, linkId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (!linkId || typeof linkId !== 'string') {
    return apiResponse.badRequest(res, 'Link ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(res, projectId, linkId);
    case 'PATCH':
      return handlePatch(req as AuthenticatedNextApiRequest, res, projectId, linkId);
    case 'DELETE':
      return handleDelete(req as AuthenticatedNextApiRequest, res, projectId, linkId);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
  }
}

/**
 * GET /api/projects/[projectId]/pipeline-links/[linkId]
 * Get single link with full details
 */
async function handleGet(res: NextApiResponse, projectId: string, linkId: string) {
  try {
    const link = await sql`
      SELECT
        ppl.id, ppl.project_id, ppl.pipeline_project_id, ppl.is_primary,
        ppl.notes, ppl.link_order, ppl.linked_at, ppl.updated_at,
        pp.project_name as pipeline_project_name,
        pp.pipeline_status,
        pp.area as pipeline_area,
        pp.municipality as pipeline_municipality,
        pp.province as pipeline_province,
        pp.client_id,
        c.name as client_name,
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
      LEFT JOIN clients c ON c.id = pp.client_id
      WHERE ppl.id = ${linkId} AND ppl.project_id = ${projectId}
    `;

    if (link.length === 0) {
      return apiResponse.notFound(res, 'Pipeline link', linkId);
    }

    return apiResponse.success(res, link[0]);
  } catch (error) {
    log.error('Failed to fetch pipeline link', { projectId, linkId, error }, 'pipeline-links-api');
    return apiResponse.databaseError(res, error, 'Failed to fetch pipeline link');
  }
}

/**
 * PATCH /api/projects/[projectId]/pipeline-links/[linkId]
 * Update link (set primary, update notes, etc.)
 */
async function handlePatch(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  projectId: string,
  linkId: string
) {
  try {
    const { is_primary, notes, link_order } = req.body;

    // Verify link exists
    const existingLink = await sql`
      SELECT id, pipeline_project_id, is_primary FROM project_pipeline_links
      WHERE id = ${linkId} AND project_id = ${projectId}
    `;

    if (existingLink.length === 0) {
      return apiResponse.notFound(res, 'Pipeline link', linkId);
    }

    const currentLink = existingLink[0] as { pipeline_project_id: string; is_primary: boolean };

    // If setting as primary, unset any other primary links
    if (is_primary && !currentLink.is_primary) {
      await sql`
        UPDATE project_pipeline_links
        SET is_primary = false, updated_at = NOW()
        WHERE project_id = ${projectId} AND is_primary = true AND id != ${linkId}
      `;

      // Update legacy column for backward compatibility
      await sql`
        UPDATE projects
        SET pipeline_project_id = ${currentLink.pipeline_project_id}
        WHERE id = ${projectId}
      `;
    }

    // Update the link
    await sql`
      UPDATE project_pipeline_links SET
        is_primary = COALESCE(${is_primary}, is_primary),
        notes = COALESCE(${notes}, notes),
        link_order = COALESCE(${link_order}, link_order),
        updated_at = NOW()
      WHERE id = ${linkId}
    `;

    // Fetch with joined details
    const link = await sql`
      SELECT
        ppl.id, ppl.project_id, ppl.pipeline_project_id, ppl.is_primary,
        ppl.notes, ppl.link_order, ppl.linked_at, ppl.updated_at,
        pp.project_name as pipeline_project_name,
        pp.pipeline_status,
        pp.area as pipeline_area,
        pp.municipality as pipeline_municipality
      FROM project_pipeline_links ppl
      JOIN pipeline_projects pp ON pp.id = ppl.pipeline_project_id
      WHERE ppl.id = ${linkId}
    `;

    log.info('Updated pipeline link', {
      projectId,
      linkId,
      isPrimary: is_primary,
    }, 'pipeline-links-api');

    return apiResponse.success(res, link[0], 'Pipeline link updated');
  } catch (error) {
    log.error('Failed to update pipeline link', { projectId, linkId, error }, 'pipeline-links-api');
    return apiResponse.databaseError(res, error, 'Failed to update pipeline link');
  }
}

/**
 * DELETE /api/projects/[projectId]/pipeline-links/[linkId]
 * Remove a pipeline link
 */
async function handleDelete(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  projectId: string,
  linkId: string
) {
  try {
    // Verify link exists and get its details
    const existingLink = await sql`
      SELECT id, is_primary, pipeline_project_id FROM project_pipeline_links
      WHERE id = ${linkId} AND project_id = ${projectId}
    `;

    if (existingLink.length === 0) {
      return apiResponse.notFound(res, 'Pipeline link', linkId);
    }

    const link = existingLink[0] as { is_primary: boolean; pipeline_project_id: string };
    const wasPrimary = link.is_primary;

    // Delete the link
    await sql`
      DELETE FROM project_pipeline_links WHERE id = ${linkId}
    `;

    // If this was the primary link, set another link as primary (if any exist)
    if (wasPrimary) {
      const remainingLinks = await sql`
        SELECT id FROM project_pipeline_links
        WHERE project_id = ${projectId}
        ORDER BY link_order ASC, linked_at ASC
        LIMIT 1
      `;

      if (remainingLinks.length > 0) {
        const newPrimaryId = (remainingLinks[0] as { id: string }).id;
        const newPrimary = await sql`
          UPDATE project_pipeline_links
          SET is_primary = true, updated_at = NOW()
          WHERE id = ${newPrimaryId}
          RETURNING pipeline_project_id
        `;

        // Update legacy column
        await sql`
          UPDATE projects
          SET pipeline_project_id = ${(newPrimary[0] as { pipeline_project_id: string }).pipeline_project_id}
          WHERE id = ${projectId}
        `;
      } else {
        // No links remaining, clear legacy column
        await sql`
          UPDATE projects SET pipeline_project_id = NULL WHERE id = ${projectId}
        `;
      }
    }

    log.info('Deleted pipeline link', {
      projectId,
      linkId,
      wasPrimary,
    }, 'pipeline-links-api');

    return apiResponse.success(res, { deleted: true }, 'Pipeline link removed');
  } catch (error) {
    log.error('Failed to delete pipeline link', { projectId, linkId, error }, 'pipeline-links-api');
    return apiResponse.databaseError(res, error, 'Failed to delete pipeline link');
  }
}

export default withAuth(withErrorHandler(handler));
