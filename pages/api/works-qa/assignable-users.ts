import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';

// Roles eligible to receive works-qa snag assignments. Mirrors the project-team
// roles likely to fix on-site issues; site managers, project managers, QA leads.
const ASSIGNABLE_ROLES = new Set([
  'site manager',
  'project manager',
  'qa manager',
  'civils lead',
  'optical lead',
]);

interface AssignableUser {
  user_id: string;
  name: string;
  email: string | null;
  role: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : null;
  if (!projectId) return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'project_id query param is required');

  try {
    // v_project_team.person_id = staff.id; staff.user_id = users.id.
    // Bridge so the snag-assign FK (snags.assigned_to → users.id) gets a valid value.
    const { rows } = await pool.query<{
      user_id: string;
      name: string;
      email: string | null;
      role: string;
    }>(
      `SELECT DISTINCT s.user_id, vpt.name, vpt.email, vpt.role
         FROM v_project_team vpt
         JOIN staff s ON s.id::text = vpt.person_id
        WHERE vpt.project_id = $1
          AND vpt.person_type = 'staff'
          AND vpt.is_active = true
          AND s.user_id IS NOT NULL
        ORDER BY vpt.name`,
      [projectId]
    );
    const users: AssignableUser[] = rows.filter(r => ASSIGNABLE_ROLES.has(r.role.toLowerCase()));
    return apiResponse.success(res, { users });
  } catch (err) {
    log.error('works-qa/assignable-users', { error: err instanceof Error ? err.message : String(err), projectId });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
