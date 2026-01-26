/**
 * Project Team API
 * GET /api/projects/[projectId]/team
 *
 * Returns unified team (staff + contractors) for a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId, includeInactive } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  try {
    const sql = getSql();

    // Check project exists
    const projectExists = await sql`
      SELECT id FROM projects WHERE id = ${projectId}
    `;

    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    // Get team members from the unified view
    const showInactive = includeInactive === 'true';

    const teamMembers = showInactive
      ? await sql`
          SELECT
            person_id,
            person_type,
            name,
            email,
            phone,
            role,
            start_date,
            end_date,
            is_active,
            is_primary,
            created_at
          FROM v_project_team
          WHERE project_id = ${projectId}
          ORDER BY is_primary DESC, person_type, name
        `
      : await sql`
          SELECT
            person_id,
            person_type,
            name,
            email,
            phone,
            role,
            start_date,
            end_date,
            is_active,
            is_primary,
            created_at
          FROM v_project_team
          WHERE project_id = ${projectId}
          AND is_active = true
          ORDER BY is_primary DESC, person_type, name
        `;

    // Format response
    const response = teamMembers.map(member => ({
      personId: member.person_id,
      personType: member.person_type,
      name: member.name,
      email: member.email,
      phone: member.phone,
      role: member.role,
      startDate: member.start_date,
      endDate: member.end_date,
      isActive: member.is_active,
      isPrimary: member.is_primary,
      createdAt: member.created_at,
    }));

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error fetching project team', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
