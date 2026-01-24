/**
 * Example: Projects API route with Zod validation (Pages Router)
 * This demonstrates how to use the centralized Zod schemas with the Pages Router
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '../../../lib/auth-mock';
import { neon } from '@neondatabase/serverless';
import { safeArrayQuery, safeMutation } from '../../../lib/safe-query';
import { apiResponse } from '../../../src/lib/apiResponse';

// Import Zod schemas and validation utilities
import {
  ProjectQuerySchema,
  CreateProjectSchema,
  UpdateProjectSchema,
  ProjectParamsSchema,
  ApiSuccessResponseSchema,
  ApiPaginatedResponseSchema,
  PaginationMetaSchema,
  safeParse,
  formatZodError,
  z,
} from '../../../src/lib/schemas';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Enable CORS for Vercel deployment
  apiResponse.setCorsHeaders(res);

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    return apiResponse.handleOptions(res);
  }

  // Check authentication
  const { userId } = getAuth(req);
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Validate query parameters
        const queryValidation = safeParse(req.query, ProjectQuerySchema);
        
        if (!queryValidation.success) {
          return res.status(400).json({
            success: false,
            error: queryValidation.error,
            timestamp: new Date().toISOString(),
          });
        }

        const query = queryValidation.data;
        
        // Get single project by ID
        if (req.query.id) {
          const paramsValidation = safeParse({ id: req.query.id }, ProjectParamsSchema);
          
          if (!paramsValidation.success) {
            return res.status(400).json({
              success: false,
              error: paramsValidation.error,
              timestamp: new Date().toISOString(),
            });
          }

          const project = await safeArrayQuery(
            async () => sql`
              SELECT p.*, c.client_name 
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id::text::uuid
              WHERE p.id = ${paramsValidation.data.id}
            `,
            { logError: true }
          );
          
          if (project.length === 0) {
            return apiResponse.notFound(res, 'Project', paramsValidation.data.id);
          }
          
          return res.status(200).json({
            success: true,
            data: project[0],
            message: 'Project retrieved successfully',
            timestamp: new Date().toISOString(),
          });
        }
        
        // Get paginated projects list
        const { page = 1, limit = 10, sortBy = 'created_at', sortOrder = 'desc' } = query;
        const offset = (page - 1) * limit;
        
        // Build dynamic WHERE clause based on filters
        const whereConditions: string[] = [];
        const queryParams: any[] = [];
        
        if (query.search) {
          whereConditions.push(`(p.project_name ILIKE $${queryParams.length + 1} OR p.project_code ILIKE $${queryParams.length + 2})`);
          queryParams.push(`%${query.search}%`, `%${query.search}%`);
        }
        
        if (query.status) {
          const statuses = Array.isArray(query.status) ? query.status : [query.status];
          whereConditions.push(`p.status = ANY($${queryParams.length + 1}::text[])`);
          queryParams.push(statuses);
        }
        
        if (query.priority) {
          const priorities = Array.isArray(query.priority) ? query.priority : [query.priority];
          whereConditions.push(`p.priority = ANY($${queryParams.length + 1}::text[])`);
          queryParams.push(priorities);
        }
        
        if (query.clientId) {
          whereConditions.push(`p.client_id = $${queryParams.length + 1}`);
          queryParams.push(query.clientId);
        }
        
        const whereClause = whereConditions.length > 0 
          ? `WHERE ${whereConditions.join(' AND ')}` 
          : '';
        
        // Get total count for pagination
        const countResult = await safeArrayQuery(
          async () => sql`
            SELECT COUNT(*) as total 
            FROM projects p
            ${whereClause}
          `,
          { logError: true }
        );
        
        const total = parseInt(countResult[0]?.total || '0');
        const totalPages = Math.ceil(total / limit);
        
        // Get paginated projects
        const projects = await safeArrayQuery(
          async () => sql`
            SELECT p.*, c.client_name 
            FROM projects p
            LEFT JOIN clients c ON p.client_id = c.id::text::uuid
            ${whereClause}
            ORDER BY p.${sortBy} ${sortOrder} NULLS LAST
            LIMIT ${limit} OFFSET ${offset}
          `,
          { logError: true, retryCount: 2 }
        );
        
        const paginationMeta = PaginationMetaSchema.parse({
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        });
        
        return res.status(200).json({
          success: true,
          data: projects || [],
          meta: paginationMeta,
          message: projects.length === 0 ? 'No projects found' : undefined,
          timestamp: new Date().toISOString(),
        });
      }

      case 'POST': {
        // Validate request body
        const bodyValidation = safeParse(req.body, CreateProjectSchema);
        
        if (!bodyValidation.success) {
          return res.status(400).json({
            success: false,
            error: bodyValidation.error,
            timestamp: new Date().toISOString(),
          });
        }
        
        const projectData = bodyValidation.data;
        
        const result = await safeMutation(
          async () => sql`
            INSERT INTO projects (
              project_code, project_name, client_id, description, 
              project_type, status, priority, start_date, end_date, 
              budget, project_manager, location
            )
            VALUES (
              ${projectData.projectCode}, ${projectData.name}, 
              ${projectData.clientId}, ${projectData.description},
              ${projectData.type}, ${projectData.status || 'draft'},
              ${projectData.priority || 'medium'}, ${projectData.startDate},
              ${projectData.endDate}, ${JSON.stringify(projectData.budget)},
              ${projectData.projectManagerId}, ${JSON.stringify(projectData.location)}
            )
            RETURNING *
          `,
          { logError: true }
        );
        
        if (!result.success) {
          return apiResponse.databaseError(
            res, 
            new Error(result.error || 'Failed to create project'),
            result.error || 'Failed to create project'
          );
        }
        
        return res.status(201).json({
          success: true,
          data: result.data?.[0],
          message: 'Project created successfully',
          timestamp: new Date().toISOString(),
        });
      }

      case 'PUT': {
        // Validate project ID
        if (!req.query.id) {
          return apiResponse.validationError(res, { id: 'Project ID is required' });
        }
        
        const paramsValidation = safeParse({ id: req.query.id }, ProjectParamsSchema);
        
        if (!paramsValidation.success) {
          return res.status(400).json({
            success: false,
            error: paramsValidation.error,
            timestamp: new Date().toISOString(),
          });
        }
        
        // Validate request body
        const bodyValidation = safeParse(req.body, UpdateProjectSchema);
        
        if (!bodyValidation.success) {
          return res.status(400).json({
            success: false,
            error: bodyValidation.error,
            timestamp: new Date().toISOString(),
          });
        }
        
        const updateData = bodyValidation.data;
        
        const updateResult = await safeMutation(
          async () => sql`
            UPDATE projects SET
              project_name = COALESCE(${updateData.name}, project_name),
              client_id = COALESCE(${updateData.clientId}, client_id),
              description = COALESCE(${updateData.description}, description),
              project_type = COALESCE(${updateData.type}, project_type),
              status = COALESCE(${updateData.status}, status),
              priority = COALESCE(${updateData.priority}, priority),
              start_date = COALESCE(${updateData.startDate}, start_date),
              end_date = COALESCE(${updateData.endDate}, end_date),
              budget = COALESCE(${updateData.budget ? JSON.stringify(updateData.budget) : null}, budget),
              project_manager = COALESCE(${updateData.projectManagerId}, project_manager),
              location = COALESCE(${updateData.location ? JSON.stringify(updateData.location) : null}, location),
              updated_at = NOW()
            WHERE id = ${paramsValidation.data.id}
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
        
        return res.status(200).json({
          success: true,
          data: updateResult.data?.[0],
          message: 'Project updated successfully',
          timestamp: new Date().toISOString(),
        });
      }

      case 'DELETE': {
        // Validate project ID
        if (!req.query.id) {
          return apiResponse.validationError(res, { id: 'Project ID is required' });
        }
        
        const paramsValidation = safeParse({ id: req.query.id }, ProjectParamsSchema);
        
        if (!paramsValidation.success) {
          return res.status(400).json({
            success: false,
            error: paramsValidation.error,
            timestamp: new Date().toISOString(),
          });
        }
        
        const deleteResult = await safeMutation(
          async () => sql`DELETE FROM projects WHERE id = ${paramsValidation.data.id}`,
          { logError: true }
        );
        
        if (!deleteResult.success) {
          return apiResponse.databaseError(
            res,
            new Error(deleteResult.error || 'Failed to delete project'),
            deleteResult.error || 'Failed to delete project'
          );
        }
        
        return res.status(200).json({
          success: true,
          data: null,
          message: 'Project deleted successfully',
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'PUT', 'DELETE']);
    }
  } catch (error: any) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      },
      timestamp: new Date().toISOString(),
    });
  }
}

export default withAuth(handler);
