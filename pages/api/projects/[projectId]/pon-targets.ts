/**
 * API Route: /api/projects/[projectId]/pon-targets
 *
 * GET  - Returns monthly targets for all categories
 * PUT  - Set/update a monthly target
 *
 * Query (GET): ?month=2026-03
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId } = req.query;
  const projectIdStr = Array.isArray(projectId) ? projectId[0] : projectId;

  if (!projectIdStr) {
    return apiResponse.badRequest(res, 'Missing projectId');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, projectIdStr);
  }
  if (req.method === 'PUT') {
    return handlePut(req, res, projectIdStr);
  }
  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  const { month } = req.query;
  const monthStr = Array.isArray(month) ? month[0] : month;

  const client = await pool.connect();
  try {
    let query = `
      SELECT id, project_id, month::text as month, category,
             target_pons, target_hps,
             created_at::text as created_at, updated_at::text as updated_at
      FROM project_monthly_targets
      WHERE project_id = $1
    `;
    const params: string[] = [projectId];

    if (monthStr) {
      // Normalize to first day of month
      const monthDate = monthStr.length === 7 ? `${monthStr}-01` : monthStr;
      query += ' AND month = $2';
      params.push(monthDate);
    }

    query += ' ORDER BY month DESC, category';

    const result = await client.query(query, params);

    return res.status(200).json({
      project_id: projectId,
      targets: result.rows,
    });
  } catch (error) {
    log.error('Failed to fetch monthly targets', { error, projectId }, 'PonTargets');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  } finally {
    client.release();
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, projectId: string) {
  const { month, category, target_pons, target_hps } = req.body;

  if (!month || !category) {
    return apiResponse.badRequest(res, 'Missing month or category');
  }

  const validCats = ['cwc', 'optical', 'activation', 'maintenance'];
  if (!validCats.includes(category)) {
    return apiResponse.badRequest(res, 'Invalid category');
  }

  // Normalize month to first day
  const monthDate = month.length === 7 ? `${month}-01` : month;

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO project_monthly_targets (project_id, month, category, target_pons, target_hps)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, month, category) DO UPDATE
       SET target_pons = EXCLUDED.target_pons, target_hps = EXCLUDED.target_hps, updated_at = NOW()`,
      [projectId, monthDate, category, target_pons || 0, target_hps || 0]
    );

    log.info('Monthly target set', { projectId, month: monthDate, category }, 'PonTargets');
    return res.status(200).json({ success: true });
  } catch (error) {
    log.error('Failed to set monthly target', { error, projectId }, 'PonTargets');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  } finally {
    client.release();
  }
}

export default withAuth(handler);
