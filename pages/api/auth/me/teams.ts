/**
 * Current User Teams API
 * GET /api/auth/me/teams
 * Returns team memberships for the currently authenticated user
 */

import type { NextApiResponse } from 'next';
import {
  withAuth,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth:me:teams');

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.team_type
       FROM teams t
       JOIN team_members tmem ON tmem.team_id = t.id
       WHERE tmem.user_id = $1 AND tmem.is_active = true`,
      [req.user.id]
    );

    return apiResponse.success(res, { teams: result.rows });
  } catch (err) {
    logger.error('Failed to fetch user teams', { error: err, userId: req.user.id });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
