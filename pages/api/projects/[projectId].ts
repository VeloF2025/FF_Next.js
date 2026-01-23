import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { safeArrayQuery, safeMutation } from '../../../lib/safe-query';
import { apiResponse } from '../../../lib/apiResponse';
import { logUpdate, logDelete } from '../../../lib/db-logger';

/**
 * Project API Route
 * GET /api/projects/[projectId] - Get a single project
 * PUT /api/projects/[projectId] - Update a project
 * DELETE /api/projects/[projectId] - Delete a project
 */

// Create a new connection for each request to avoid connection pooling issues
const getSql = () => neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { projectId: id } = req.query;

  try {
    // Get authentication
    const { userId } = getAuth(req);

    if (!userId) {
      return apiResponse.unauthorized(res);
    }

    if (!id || typeof id !== 'string') {
      return apiResponse.validationError(res, { id: 'Project ID is required' });
    }

    switch (req.method) {
      case 'GET': {
        const sql = getSql();
        const project = await safeArrayQuery(
          async () => sql`
            SELECT
              p.id,
              p.project_code,
              p.project_name as name,
              p.client_id,
              p.description,
              p.project_type as type,
              p.status,
              p.priority,
              p.start_date,
              p.end_date,
              p.budget,
              p.actual_cost,
              p.project_manager,
              COALESCE(s.first_name || ' ' || s.last_name, u.name, p.project_manager) as project_manager_name,
              p.progress,
              p.created_at,
              p.updated_at,
              c.company_name as client_name
            FROM projects p
            LEFT JOIN clients c ON p.client_id = c.id
            LEFT JOIN staff s ON p.project_manager::text = s.id::text
            LEFT JOIN users u ON p.project_manager::text = u.id::text
            WHERE p.id = ${id}
          `,
          { logError: true }
        );

        if (!project || project.length === 0) {
          return apiResponse.notFound(res, 'Project', id);
        }

        return apiResponse.success(res, project[0]);
      }

      case 'PUT': {
        const updateData = req.body;
        const sql = getSql();
        const updateResult = await safeMutation(
          async () => sql`
            UPDATE projects SET
              project_name = COALESCE(${updateData.project_name}, project_name),
              client_id = COALESCE(${updateData.client_id}, client_id),
              description = COALESCE(${updateData.description}, description),
              project_type = COALESCE(${updateData.project_type}, project_type),
              status = COALESCE(${updateData.status}, status),
              priority = COALESCE(${updateData.priority}, priority),
              start_date = COALESCE(${updateData.start_date}, start_date),
              end_date = COALESCE(${updateData.end_date}, end_date),
              budget = COALESCE(${updateData.budget}, budget),
              project_manager = COALESCE(${updateData.project_manager}, project_manager),
              location = COALESCE(${updateData.location}, location),
              updated_at = NOW()
            WHERE id = ${id}
            RETURNING *
          `,
          { logError: true }
        );

        if (!updateResult.success) {
          return apiResponse.databaseError(
            res,
            new Error(updateResult.error || 'Failed to update project'),
            updateResult.error || 'Failed to update project'
          );
        }

        // Log successful project update
        const updatedProject = updateResult.data?.[0];
        if (updatedProject) {
          logUpdate('project', id, {
            updated_fields: Object.keys(updateData),
            updated_by: userId
          });
        }

        return apiResponse.success(res, updatedProject, 'Project updated successfully');
      }

      case 'DELETE': {
        const sql = getSql();
        const deleteResult = await safeMutation(
          async () => sql`DELETE FROM projects WHERE id = ${id}`,
          { logError: true }
        );

        if (!deleteResult.success) {
          return apiResponse.databaseError(
            res,
            new Error(deleteResult.error || 'Failed to delete project'),
            deleteResult.error || 'Failed to delete project'
          );
        }

        // Log successful project deletion
        logDelete('project', id);

        return apiResponse.success(res, null, 'Project deleted successfully');
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
    }
  } catch (error: any) {
    return apiResponse.internalError(res, error);
  }
}