/**
 * Project Wayleaves API
 * GET /api/projects/[projectId]/wayleaves - Get all wayleave approvals for a project
 * POST /api/projects/[projectId]/wayleaves - Create new wayleave approval
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { PipelineProjectApprovalWithType } from '@/modules/pipeline/types';

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
 * GET /api/projects/[projectId]/wayleaves
 * Get all wayleave approvals for a project (via pipeline link or standalone)
 */
async function handleGet(res: NextApiResponse, projectId: string) {
  try {
    // First check if project exists
    const projectResult = await sql`
      SELECT id, project_name, pipeline_project_id
      FROM projects
      WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = projectResult[0] as { id: string; project_name: string; pipeline_project_id: string | null };

    // Check junction table first for primary link (new system)
    const primaryLinkResult = await sql`
      SELECT pipeline_project_id FROM project_pipeline_links
      WHERE project_id = ${projectId} AND is_primary = true
      LIMIT 1
    `;

    // Use junction table if available, fall back to legacy column
    let pipelineProjectId: string | null = null;
    if (primaryLinkResult.length > 0) {
      pipelineProjectId = (primaryLinkResult[0] as { pipeline_project_id: string }).pipeline_project_id;
    } else if (project.pipeline_project_id) {
      // Backward compatibility: use legacy column
      pipelineProjectId = project.pipeline_project_id;
    }

    // If project has pipeline link, fetch approvals from pipeline
    if (pipelineProjectId) {
      const approvals = await sql`
        SELECT
          a.*,
          t.code AS approval_type_code,
          t.name AS approval_type_name,
          t.category AS approval_type_category,
          COALESCE(t.is_compulsory, false) AS approval_type_is_compulsory,
          t.condition_type AS approval_type_condition_type
        FROM pipeline_project_approvals a
        JOIN pipeline_approval_types t ON a.approval_type_id = t.id
        WHERE a.pipeline_project_id = ${pipelineProjectId}
          AND t.category = 'wayleave'
        ORDER BY t.display_order, t.name
      `;

      // Calculate status summary
      const required = (approvals as PipelineProjectApprovalWithType[]).filter(a => a.is_required);
      const approved = required.filter(a =>
        ['approved', 'conditionally_approved', 'renewed'].includes(a.status)
      );
      const expired = approved.filter(a => {
        if (!a.expiry_date) return false;
        return new Date(a.expiry_date) < new Date();
      });
      const expiring = approved.filter(a => {
        if (!a.expiry_date) return false;
        const daysUntil = Math.ceil((new Date(a.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        return daysUntil > 0 && daysUntil <= 90;
      });
      // Valid = approved and not expired
      const valid = approved.length - expired.length;

      return apiResponse.success(res, {
        approvals,
        pipeline_project_id: pipelineProjectId,
        status: {
          total: required.length,
          approved: approved.length,
          pending: required.length - approved.length,
          expiring_count: expiring.length,
          expired_count: expired.length,
          // Progress based on valid (non-expired) approvals
          progress: required.length > 0 ? Math.round((valid / required.length) * 100) : 0,
        },
        expiring_alerts: [...expired, ...expiring].map(a => ({
          id: a.id,
          name: a.approval_type_name,
          expiry_date: a.expiry_date,
          days_until: Math.ceil((new Date(a.expiry_date!).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        })),
      });
    }

    // No pipeline link - return empty with option to create tracking
    return apiResponse.success(res, {
      approvals: [],
      pipeline_project_id: null,
      status: {
        total: 0,
        approved: 0,
        pending: 0,
        expiring_count: 0,
        expired_count: 0,
        progress: 0,
      },
      expiring_alerts: [],
      message: 'This project was not created from the pipeline. Wayleave tracking can be set up manually.',
    });
  } catch (error) {
    log.error('Failed to fetch project wayleaves', { projectId, error }, 'wayleaves-api');
    return apiResponse.databaseError(res, error, 'Failed to fetch wayleaves');
  }
}

/**
 * POST /api/projects/[projectId]/wayleaves
 * Create new wayleave approval for a project
 */
async function handlePost(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  projectId: string
) {
  try {
    const userName = req.user?.name || req.user?.id || 'unknown';
    const { approval_type_id, ...rest } = req.body;

    if (!approval_type_id) {
      return apiResponse.badRequest(res, 'Approval type ID is required');
    }

    // Verify project exists
    const projectResult = await sql`
      SELECT id, pipeline_project_id
      FROM projects
      WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = projectResult[0] as { id: string; pipeline_project_id: string | null };

    // Check junction table first for primary link (new system)
    const primaryLinkResult = await sql`
      SELECT pipeline_project_id FROM project_pipeline_links
      WHERE project_id = ${projectId} AND is_primary = true
      LIMIT 1
    `;

    // Use junction table if available, fall back to legacy column
    let pipelineProjectId: string | null = null;
    if (primaryLinkResult.length > 0) {
      pipelineProjectId = (primaryLinkResult[0] as { pipeline_project_id: string }).pipeline_project_id;
    } else if (project.pipeline_project_id) {
      pipelineProjectId = project.pipeline_project_id;
    }

    if (!pipelineProjectId) {
      return apiResponse.badRequest(res, 'Project does not have a pipeline link. Cannot add wayleave approvals.');
    }

    // Verify the approval type is a wayleave type
    const typeResult = await sql`
      SELECT id, category FROM pipeline_approval_types WHERE id = ${approval_type_id}
    `;

    if (typeResult.length === 0) {
      return apiResponse.notFound(res, 'Approval type', approval_type_id);
    }

    const approvalType = typeResult[0] as { id: string; category: string };
    if (approvalType.category !== 'wayleave') {
      return apiResponse.badRequest(res, 'Only wayleave approval types can be added via this endpoint');
    }

    // Create the approval in pipeline_project_approvals
    const result = await sql`
      INSERT INTO pipeline_project_approvals (
        pipeline_project_id, approval_type_id, is_required,
        authority_name, authority_contact_name, authority_contact_email,
        authority_contact_phone, authority_address, notes, created_by
      ) VALUES (
        ${pipelineProjectId},
        ${approval_type_id},
        ${rest.is_required ?? true},
        ${rest.authority_name || null},
        ${rest.authority_contact_name || null},
        ${rest.authority_contact_email || null},
        ${rest.authority_contact_phone || null},
        ${rest.authority_address || null},
        ${rest.notes || null},
        ${userName}
      )
      RETURNING *
    `;

    // Fetch with type info
    const approvalWithType = await sql`
      SELECT
        a.*,
        t.code AS approval_type_code,
        t.name AS approval_type_name,
        t.category AS approval_type_category,
        COALESCE(t.is_compulsory, false) AS approval_type_is_compulsory,
        t.condition_type AS approval_type_condition_type
      FROM pipeline_project_approvals a
      JOIN pipeline_approval_types t ON a.approval_type_id = t.id
      WHERE a.id = ${(result[0] as { id: string }).id}
    `;

    log.info('Created wayleave approval for project', {
      projectId,
      pipelineProjectId,
      approvalId: (result[0] as { id: string }).id,
    }, 'wayleaves-api');

    return apiResponse.created(res, approvalWithType[0]);
  } catch (error) {
    log.error('Failed to create wayleave approval', { projectId, error }, 'wayleaves-api');
    return apiResponse.databaseError(res, error, 'Failed to create wayleave approval');
  }
}

export default withAuth(withErrorHandler(handler));
