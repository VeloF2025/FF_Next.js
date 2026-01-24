/**
 * Pipeline Projects API
 * GET /api/pipeline/projects - List projects with filters
 * POST /api/pipeline/projects - Create new project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineProjectService } from '@/modules/pipeline/services/pipelineProjectService';
import type {
  PipelineProjectFilters,
  PipelineProjectSort,
  CreatePipelineProjectInput,
} from '@/modules/pipeline/types';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

/**
 * GET /api/pipeline/projects
 * Query params:
 * - search: string - Search by name, code, description
 * - pipeline_status: string | string[] - Filter by status
 * - priority: string | string[] - Filter by priority
 * - client_id: string - Filter by client
 * - project_manager_id: string - Filter by PM
 * - wayleaves_officer_id: string - Filter by wayleaves officer
 * - province: string - Filter by province
 * - municipality: string - Filter by municipality
 * - project_type: string - Filter by type
 * - has_po: boolean - Filter by PO status
 * - sort_by: string - Sort field
 * - sort_dir: 'asc' | 'desc' - Sort direction
 * - page: number - Page number (default 1)
 * - limit: number - Items per page (default 20)
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const {
    search,
    pipeline_status,
    priority,
    client_id,
    project_manager_id,
    wayleaves_officer_id,
    province,
    municipality,
    project_type,
    has_po,
    created_after,
    created_before,
    sort_by,
    sort_dir,
    page = '1',
    limit = '20',
  } = req.query;

  // Build filters
  const filters: PipelineProjectFilters = {};

  if (search) filters.search = String(search);
  if (pipeline_status) {
    filters.pipeline_status = Array.isArray(pipeline_status)
      ? (pipeline_status as any)
      : (pipeline_status as any);
  }
  if (priority) {
    filters.priority = Array.isArray(priority)
      ? (priority as any)
      : (priority as any);
  }
  if (client_id) filters.client_id = String(client_id);
  if (project_manager_id) filters.project_manager_id = String(project_manager_id);
  if (wayleaves_officer_id) filters.wayleaves_officer_id = String(wayleaves_officer_id);
  if (province) filters.province = String(province);
  if (municipality) filters.municipality = String(municipality);
  if (project_type) filters.project_type = project_type as any;
  if (has_po !== undefined) filters.has_po = has_po === 'true';
  if (created_after) filters.created_after = String(created_after);
  if (created_before) filters.created_before = String(created_before);

  // Build sort
  let sort: PipelineProjectSort | undefined;
  if (sort_by) {
    sort = {
      field: String(sort_by) as any,
      direction: sort_dir === 'asc' ? 'asc' : 'desc',
    };
  }

  const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));

  const result = await pipelineProjectService.listProjects(
    filters,
    sort,
    pageNum,
    limitNum
  );

  return apiResponse.success(res, result);
}

/**
 * POST /api/pipeline/projects
 * Create a new pipeline project
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const input = req.body as CreatePipelineProjectInput;

  // Validate required fields
  if (!input.project_name?.trim()) {
    return apiResponse.badRequest(res, 'Project name is required');
  }

  // Create project
  const project = await pipelineProjectService.createProject(input);

  // Add default required approvals
  await pipelineProjectService.addDefaultApprovals(project.id, input.created_by);

  // Fetch with relations
  const projectWithRelations = await pipelineProjectService.getProjectById(project.id);

  return apiResponse.created(res, projectWithRelations);
}

export default withAuth(withErrorHandler(handler));
