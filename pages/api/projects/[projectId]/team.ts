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

    // Format members
    const members = teamMembers.map(member => ({
      person_id: member.person_id,
      person_type: member.person_type,
      name: member.name,
      email: member.email,
      phone: member.phone,
      role: member.role,
      start_date: member.start_date,
      end_date: member.end_date,
      is_active: member.is_active,
      is_primary: member.is_primary,
      created_at: member.created_at,
    }));

    // Find primary manager
    const primary = members.find(m => m.is_primary && m.person_type === 'staff');
    const primaryManager = primary
      ? { staff_id: primary.person_id, name: primary.name, role: primary.role || 'Project Manager', is_primary: true }
      : null;

    // Calculate stats
    const stats = {
      staff: members.filter(m => m.person_type === 'staff').length,
      contractors: members.filter(m => m.person_type === 'contractor').length,
      total: members.length,
    };

    return apiResponse.success(res, { primaryManager, members, stats });
  } catch (error) {
    log.error('Error fetching project team', { error, projectId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
