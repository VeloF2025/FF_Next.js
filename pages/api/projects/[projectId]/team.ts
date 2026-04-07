/**
 * Project Team API
 * GET    /api/projects/[projectId]/team  - List team
 * POST   /api/projects/[projectId]/team  - Add member
 * DELETE /api/projects/[projectId]/team  - Remove member
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.validationError(res, { projectId: 'Project ID is required' });
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res, projectId);
    case 'POST':
      return handlePost(req, res, projectId);
    case 'DELETE':
      return handleDelete(req, res, projectId);
    default:
      return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST', 'DELETE']);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  const { includeInactive } = req.query;

  try {
    const sql = getSql();

    const projectExists = await sql`SELECT id FROM projects WHERE id = ${projectId}`;
    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const showInactive = includeInactive === 'true';

    const teamMembers = showInactive
      ? await sql`
          SELECT person_id, person_type, name, email, phone, role,
                 start_date, end_date, is_active, is_primary, created_at
          FROM v_project_team
          WHERE project_id = ${projectId}
          ORDER BY is_primary DESC, person_type, name
        `
      : await sql`
          SELECT person_id, person_type, name, email, phone, role,
                 start_date, end_date, is_active, is_primary, created_at
          FROM v_project_team
          WHERE project_id = ${projectId} AND is_active = true
          ORDER BY is_primary DESC, person_type, name
        `;

    const members = teamMembers.map(m => ({
      person_id: m.person_id,
      person_type: m.person_type,
      name: m.name,
      email: m.email,
      phone: m.phone,
      role: m.role,
      start_date: m.start_date,
      end_date: m.end_date,
      is_active: m.is_active,
      is_primary: m.is_primary,
      created_at: m.created_at,
    }));

    const primary = members.find(m => m.is_primary && m.person_type === 'staff');
    const primaryManager = primary
      ? { staff_id: primary.person_id, name: primary.name, role: primary.role || 'Project Manager', is_primary: true }
      : null;

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

async function handlePost(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  const { personId, personType, role } = req.body;

  if (!personId || !personType || !role) {
    const errors: Record<string, string> = {};
    if (!personId) errors.personId = 'Required';
    if (!personType) errors.personType = 'Required';
    if (!role) errors.role = 'Required';
    return apiResponse.validationError(res, errors);
  }

  if (!['staff', 'contractor'].includes(personType)) {
    return apiResponse.validationError(res, { personType: 'Must be staff or contractor' });
  }

  try {
    const sql = getSql();

    const projectExists = await sql`SELECT id FROM projects WHERE id = ${projectId}`;
    if (!projectExists || projectExists.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const isPrimary = role === 'Project Manager';

    if (personType === 'staff') {
      const staffExists = await sql`SELECT id FROM staff WHERE id = ${personId}`;
      if (!staffExists.length) {
        return apiResponse.notFound(res, 'Staff', personId);
      }

      const existing = await sql`
        SELECT id FROM staff_projects
        WHERE staff_id = ${personId} AND project_id = ${projectId}
      `;

      if (existing.length) {
        await sql`
          UPDATE staff_projects
          SET role = ${role}, is_primary = ${isPrimary}, is_active = true, updated_at = NOW()
          WHERE staff_id = ${personId} AND project_id = ${projectId}
        `;
      } else {
        await sql`
          INSERT INTO staff_projects (id, staff_id, project_id, role, is_primary, is_active, start_date, created_at, updated_at)
          VALUES (gen_random_uuid(), ${personId}, ${projectId}, ${role}, ${isPrimary}, true, CURRENT_DATE, NOW(), NOW())
        `;
      }
    } else {
      const contractorExists = await sql`SELECT id FROM contractors WHERE id = ${personId}`;
      if (!contractorExists.length) {
        return apiResponse.notFound(res, 'Contractor', personId);
      }

      const existing = await sql`
        SELECT id FROM contractor_projects
        WHERE contractor_id = ${personId} AND project_id = ${projectId}
      `;

      if (existing.length) {
        await sql`
          UPDATE contractor_projects
          SET role = ${role}, is_primary_contractor = ${isPrimary}, is_active = true,
              assignment_status = 'active', updated_at = NOW()
          WHERE contractor_id = ${personId} AND project_id = ${projectId}
        `;
      } else {
        await sql`
          INSERT INTO contractor_projects (contractor_id, project_id, role, is_primary_contractor, is_active, assignment_status, start_date, created_at, updated_at)
          VALUES (${personId}, ${projectId}, ${role}, ${isPrimary}, true, 'active', CURRENT_DATE, NOW(), NOW())
        `;
      }
    }

    log.info('Team member added', { projectId, personId, personType, role });
    return apiResponse.success(res, { message: 'Team member added' }, undefined, 201);
  } catch (error) {
    log.error('Error adding team member', { error, projectId, personId });
    return apiResponse.internalError(res, error as Error);
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  const { personId, personType } = req.body;

  if (!personId || !personType) {
    const errors: Record<string, string> = {};
    if (!personId) errors.personId = 'Required';
    if (!personType) errors.personType = 'Required';
    return apiResponse.validationError(res, errors);
  }

  try {
    const sql = getSql();

    if (personType === 'staff') {
      await sql`
        UPDATE staff_projects SET is_active = false, end_date = CURRENT_DATE, updated_at = NOW()
        WHERE staff_id = ${personId} AND project_id = ${projectId}
      `;
    } else {
      await sql`
        UPDATE contractor_projects
        SET is_active = false, assignment_status = 'removed', end_date = CURRENT_DATE, updated_at = NOW()
        WHERE contractor_id = ${personId} AND project_id = ${projectId}
      `;
    }

    log.info('Team member removed', { projectId, personId, personType });
    return apiResponse.success(res, { message: 'Team member removed' });
  } catch (error) {
    log.error('Error removing team member', { error, projectId, personId });
    return apiResponse.internalError(res, error as Error);
  }
}

export default withAuth(handler);
