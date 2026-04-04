/**
 * SP Tracker Data Endpoint
 * GET /api/projects/[projectId]/sp-tracker
 *
 * Returns SP Tracker summary, PON-level data, and sync metadata for a project.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL || '');

export default withAuth(async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Missing projectId');
  }

  try {
    const summaryRows = await sql`
      SELECT *
      FROM sp_project_summary
      WHERE project_id = ${projectId}
      LIMIT 1
    `;

    const summary = summaryRows.length > 0 ? summaryRows[0] : null;

    const pons = await sql`
      SELECT *
      FROM sp_pon_tracker
      WHERE project_id = ${projectId}
      ORDER BY zone_no ASC, hld_pon ASC
    `;

    const lastSyncedAt = summary?.synced_at || null;
    const totalPons = pons.length;
    const blockedPons = pons.filter((p: Record<string, unknown>) =>
      p.blockage && String(p.blockage).trim().length > 0
    ).length;

    return apiResponse.success(res, {
      summary,
      pons,
      lastSyncedAt,
      totalPons,
      blockedPons,
    });
  } catch (err) {
    log.error('Failed to fetch SP tracker data', { err, projectId }, 'api/projects/sp-tracker');
    return apiResponse.internalError(res, 'Failed to fetch tracker data');
  }
});
