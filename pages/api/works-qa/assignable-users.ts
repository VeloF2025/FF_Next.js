import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';

// Roles eligible to receive works-qa snag assignments. Stored lowercase so the
// SQL filter is case-insensitive against whatever convention v_project_team.role
// actually uses (Title Case in some seeds, lowercase in others — see
// pages/api/snags/create-ticket.ts:138 for the same LOWER() pattern).
const ASSIGNABLE_ROLES = [
  'site manager',
  'project manager',
  'qa manager',
  'civils lead',
  'optical lead',
];

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
    // Role filter runs in SQL (LOWER + ANY) so the result set is already filtered
    // before the round trip; avoids any in-process case-convention drift.
    const { rows } = await pool.query<AssignableUser>(
      `SELECT DISTINCT s.user_id, vpt.name, vpt.email, vpt.role
         FROM v_project_team vpt
         JOIN staff s ON s.id::text = vpt.person_id
        WHERE vpt.project_id = $1
          AND vpt.person_type = 'staff'
          AND vpt.is_active = true
          AND s.user_id IS NOT NULL
          AND LOWER(vpt.role) = ANY($2::text[])
        ORDER BY vpt.name`,
      [projectId, ASSIGNABLE_ROLES]
    );
    return apiResponse.success(res, { users: rows });
  } catch (err) {
    log.error('works-qa/assignable-users', { error: err instanceof Error ? err.message : String(err), projectId });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
