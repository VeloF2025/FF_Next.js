/**
 * API Route: /api/contractors-teams
 *
 * GET: List contractor teams
 * Query params: active=true to filter active teams only
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';

async function handler(
  req: NextApiRequest,
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
    log.error('contractors-teams GET', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
