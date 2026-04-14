/**
 * Current User Teams API
 * GET /api/auth/me/teams
 * Returns team memberships for the currently authenticated user
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  withAuth,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth:me:teams');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // team_members links via email, not user_id — resolve the user's email first
    const result = await pool.query(
      `SELECT t.id, t.name, t.team_type
       FROM teams t
       JOIN team_members tmem ON tmem.team_id = t.id
       JOIN users u ON LOWER(u.email) = LOWER(tmem.email)
       WHERE u.id = $1 AND tmem.is_active = true`,
      [authReq.user.id]
    );

    return apiResponse.success(res, { teams: result.rows });
  } catch (err) {
    logger.error('Failed to fetch user teams', { error: err, userId: authReq.user.id });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
