/**
 * Pipeline Project Detail API
 * GET /api/pipeline/projects/[id] - Get project details
 * PUT /api/pipeline/projects/[id] - Update project
 * DELETE /api/pipeline/projects/[id] - Hard delete project with cascade
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import type { UpdatePipelineProjectInput } from '@/modules/pipeline/types';
import { withAuth } from '@/lib/auth';
import sql from '@/lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, id);
    case 'PUT':
      return handlePut(req, res, id);
    case 'DELETE':
      return handleDelete(req, res, id);
    default:
      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

/**
 * GET /api/pipeline/projects/[id]
 * Get project with relations and approval summary
 */
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const project = await pipelineProjectService.getProjectById(id);

  if (!project) {
    return apiResponse.notFound(res, 'Pipeline project', id);
  }

  return apiResponse.success(res, project);
}

/**
 * PUT /api/pipeline/projects/[id]
 * Update project fields
 */
async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  const input = req.body as UpdatePipelineProjectInput;

  // Check project exists
  const existing = await pipelineProjectService.getProjectById(id);
  if (!existing) {
    return apiResponse.notFound(res, 'Pipeline project', id);
  }

  // Update
  const updated = await pipelineProjectService.updateProject(id, input);

  if (!updated) {
    return apiResponse.internalError(res, new Error('Failed to update project'));
  }

  // Fetch with relations
  const projectWithRelations = await pipelineProjectService.getProjectById(id);

  return apiResponse.success(res, projectWithRelations);
}

/**
 * DELETE /api/pipeline/projects/[id]
 * Hard delete project with cascade
 */
async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  id: string
) {
  // Verify project exists
  const existing = await pipelineProjectService.getProjectById(id);
  if (!existing) {
    return apiResponse.notFound(res, 'Pipeline project', id);
  }

  // Cascade delete in FK-safe order
  const unlinkResult = await sql`
    UPDATE projects SET pipeline_project_id = NULL
    WHERE pipeline_project_id = ${id}
  `;

  const linksResult = await sql`
    DELETE FROM project_pipeline_links
    WHERE pipeline_project_id = ${id}
  `;

  const docsResult = await sql`
    DELETE FROM pipeline_approval_documents
    WHERE pipeline_project_id = ${id}
  `;

  const approvalsResult = await sql`
    DELETE FROM pipeline_project_approvals
    WHERE pipeline_project_id = ${id}
  `;

  const projectResult = await sql`
    DELETE FROM pipeline_projects
    WHERE id = ${id}
  `;

  return apiResponse.success(res, {
    message: 'Project deleted successfully',
    deleted: {
      projects_unlinked: unlinkResult.count ?? 0,
      pipeline_links: linksResult.count ?? 0,
      approval_documents: docsResult.count ?? 0,
      approvals: approvalsResult.count ?? 0,
      project: projectResult.count ?? 0,
    },
  });
}

export default withAuth(withErrorHandler(handler));
