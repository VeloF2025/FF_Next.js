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

  const result = await pool.query(
    `SELECT id, name, contractor_id
     FROM contractor_teams
     ${activeOnly ? 'WHERE is_active = TRUE' : ''}
     ORDER BY name ASC`
  );

  return apiResponse.success(res, result.rows);
}

export default withAuth(handler);
