/**
 * API Route: /api/projects/[projectId]/pon-daily-log
 *
 * GET - Returns full daily log timeline for a PON
 * Query: ?pon_stage_id=X&category=optical&from=2026-03-01
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { projectId, pon_stage_id, category, from } = req.query;
  const projectIdStr = Array.isArray(projectId) ? projectId[0] : projectId;
  const ponStageId = Array.isArray(pon_stage_id) ? pon_stage_id[0] : pon_stage_id;

  if (!projectIdStr || !ponStageId) {
    return apiResponse.badRequest(res, 'Missing projectId or pon_stage_id');
  }

  const client = await pool.connect();
  try {
    // Verify PON belongs to project
    const verify = await client.query(
      'SELECT id FROM pon_stage_tracking WHERE id = $1 AND project_id = $2',
      [ponStageId, projectIdStr]
    );
    if (verify.rows.length === 0) {
      return apiResponse.notFound(res, 'PON not found in this project');
    }

    let query = `
      SELECT id, pon_stage_id, log_date::text as log_date, category, activity,
             delay_reason, logged_by, created_at::text as created_at
      FROM pon_daily_log
      WHERE pon_stage_id = $1
    `;
    const params: string[] = [ponStageId];
    let paramIdx = 2;

    const catStr = Array.isArray(category) ? category[0] : category;
    if (catStr) {
      query += ` AND category = $${paramIdx}`;
      params.push(catStr);
      paramIdx++;
    }

    const fromStr = Array.isArray(from) ? from[0] : from;
    if (fromStr) {
      query += ` AND log_date >= $${paramIdx}`;
      params.push(fromStr);
      paramIdx++;
    }

    query += ' ORDER BY log_date DESC, created_at DESC';

    const result = await client.query(query, params);

    log.info('Daily log fetched', { ponStageId, entries: result.rows.length }, 'PonDailyLog');

    return res.status(200).json({
      pon_stage_id: ponStageId,
      entries: result.rows,
      total: result.rows.length,
    });
  } catch (error) {
    log.error('Failed to fetch daily log', { error, projectId: projectIdStr }, 'PonDailyLog');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler);
