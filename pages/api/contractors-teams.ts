/**
 * API Route: /api/contractors-teams
 *
 * GET: List contractor teams
 * Query params: active=true to filter active teams only
 */

import type { NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const activeOnly = req.query.active === 'true';

  try {
    const sql = activeOnly
      ? `SELECT id, team_name AS name, contractor_id FROM contractor_teams WHERE is_active = TRUE ORDER BY team_name ASC`
      : `SELECT id, team_name AS name, contractor_id FROM contractor_teams ORDER BY team_name ASC`;

    const result = await pool.query(sql);
    return apiResponse.success(res, result.rows);
  } catch (err) {
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
