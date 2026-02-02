/**
 * Seed Project Requirements API
 * POST /api/projects/[projectId]/requirements/seed - Seed default requirements for project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { createLoggedSql } from '@/lib/db-logger';
import { log } from '@/lib/logger';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Check if project exists
    const project = await sql`
      SELECT id, name, status FROM projects WHERE id = ${projectId}
    `;

    if (project.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Call the seed function
    await sql`SELECT seed_project_requirements(${projectId}::uuid)`;

    // Get the seeded requirements count
    const requirements = await sql`
      SELECT COUNT(*) as count FROM project_requirements WHERE project_id = ${projectId}
    `;

    const count = Number(requirements[0]?.count || 0);

    log.info('Project requirements seeded', { projectId, count });

    return apiResponse.success(res, {
      message: `Seeded ${count} requirements for project`,
      count,
    });
  } catch (error) {
    log.error('Failed to seed project requirements', { projectId, error });
    return apiResponse.databaseError(res, error, 'Failed to seed project requirements');
  }
}));
