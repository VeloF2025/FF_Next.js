/**
 * Projects API Route - List and Create projects
 * GET /api/projects - List all projects (with optional filters)
 * POST /api/projects - Create a new project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { safeArrayQuery, safeMutation } from '../../../lib/safe-query';
import { apiResponse } from '../../../lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

// Create a new connection for each request
const getSql = () => neon(process.env.DATABASE_URL!);

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
  try {
    switch (req.method) {
      case 'GET': {
        const sql = getSql();
        const { status, clientId, search, limit: limitParam } = req.query;

        // If specific project ID is passed as query param
        if (req.query.id && typeof req.query.id === 'string') {
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
                COALESCE(s.first_name || ' ' || s.last_name, u.first_name || ' ' || u.last_name, p.project_manager::text) as project_manager_name,
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              LEFT JOIN staff s ON p.project_manager::text = s.id::text
              LEFT JOIN users u ON p.project_manager::text = u.id::text
              WHERE p.id = ${req.query.id}
            `,
            { logError: true }
          );

          if (!project || project.length === 0) {
            return apiResponse.notFound(res, 'Project', req.query.id);
          }

          return apiResponse.success(res, project[0]);
        }

        // List all projects with optional filters
        const limitValue = limitParam ? parseInt(limitParam as string, 10) : 1000;

        // DEBUG: Log query parameters
        log.info('Projects API - Query params', {
          data: { status, clientId, search, limitValue },
          databaseUrl: process.env.DATABASE_URL ? 'set' : 'NOT SET'
        }, 'projects/index.ts');

        // Build query based on filters
        let projects;

        if (status && clientId && search) {
          const searchPattern = `%${search}%`;
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.status = ${status}
                AND p.client_id = ${clientId}
                AND (p.project_name ILIKE ${searchPattern} OR p.project_code ILIKE ${searchPattern})
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else if (status && clientId) {
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.status = ${status} AND p.client_id = ${clientId}
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else if (status && search) {
          const searchPattern = `%${search}%`;
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.status = ${status}
                AND (p.project_name ILIKE ${searchPattern} OR p.project_code ILIKE ${searchPattern})
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else if (clientId && search) {
          const searchPattern = `%${search}%`;
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.client_id = ${clientId}
                AND (p.project_name ILIKE ${searchPattern} OR p.project_code ILIKE ${searchPattern})
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else if (status) {
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.status = ${status}
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else if (clientId) {
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.client_id = ${clientId}
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else if (search) {
          const searchPattern = `%${search}%`;
          projects = await safeArrayQuery(
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              WHERE p.project_name ILIKE ${searchPattern} OR p.project_code ILIKE ${searchPattern}
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `,
            { logError: true }
          );
        } else {
          // No filters - get all
          // DEBUG: Direct query without safeArrayQuery to see actual errors
          try {
            projects = await sql`
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
                p.progress,
                p.location,
                p.created_at,
                p.updated_at,
                c.company_name as client_name,
                -- Budget health fields
                p.budget_status,
                p.budget_health,
                p.budget_utilization,
                -- Budget summary from project_budgets
                pb.total_budget as budget_total,
                pb.committed_amount as budget_committed,
                pb.actual_amount as budget_actual,
                pb.available_budget as budget_available
              FROM projects p
              LEFT JOIN clients c ON p.client_id = c.id
              LEFT JOIN project_budgets pb ON pb.project_id = p.id
              ORDER BY p.created_at DESC
              LIMIT ${limitValue}
            `;
            log.info('Projects API - Direct query success', {
              data: { count: projects?.length || 0 }
            }, 'projects/index.ts');
          } catch (queryError: any) {
            log.error('Projects API - Query FAILED', {
              data: { error: queryError.message, stack: queryError.stack }
            }, 'projects/index.ts');
            projects = [];
          }
        }

        // DEBUG: Log query result
        log.info('Projects API - Query result', {
          data: { count: projects?.length || 0, hasData: !!projects }
        }, 'projects/index.ts');

        return apiResponse.success(res, projects || []);
      }

      case 'POST': {
        const sql = getSql();
        const {
          project_code,
          project_name,
          name, // alias for project_name
          client_id,
          description,
          project_type,
          type, // alias for project_type
          status,
          priority,
          start_date,
          end_date,
          budget,
          project_manager,
          location,
        } = req.body;

        const projectName = project_name || name;
        const projectType = project_type || type || 'FTTH';

        if (!projectName) {
          return apiResponse.validationError(res, { name: 'Project name is required' });
        }

        const result = await safeMutation(
          async () => sql`
            INSERT INTO projects (
              project_code, project_name, client_id, description,
              project_type, status, priority, start_date, end_date,
              budget, project_manager, location
            )
            VALUES (
              ${project_code || null},
              ${projectName},
              ${client_id || null},
              ${description || null},
              ${projectType},
              ${status || 'PLANNING'},
              ${priority || 'MEDIUM'},
              ${start_date || null},
              ${end_date || null},
              ${budget || null},
              ${project_manager || null},
              ${location || null}
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
        });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
    }
  } catch (error: any) {
    log.error('Projects API error:', { data: error }, 'projects/index.ts');
    return apiResponse.serverError(res, error);
  }
}

export default withAuth(handler);
