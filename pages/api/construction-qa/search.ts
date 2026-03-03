/**
 * Global Search API
 *
 * GET /api/construction-qa/search?q=LAW.P.A0042
 *   Returns up to 20 results with project/zone/pon for navigation.
 *   Searches feature_id and extracted_pole_number via ILIKE.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const q = (req.query.q as string || '').trim();
  if (!q || q.length < 2) {
    return apiResponse.success(res, { results: [] });
  }

  try {
    const results = await sql.query(
      `SELECT
        r.id,
        r.feature_id,
        r.project_id,
        p.project_name,
        r.zone_no,
        r.pon_no,
        r.discipline,
        r.workflow_status
      FROM construction_qa_reviews r
      JOIN projects p ON p.id = r.project_id
      WHERE r.feature_id ILIKE $1 OR r.extracted_pole_number ILIKE $1
      ORDER BY r.feature_id
      LIMIT 20`,
      [`%${q}%`],
    );

    return apiResponse.success(res, { results });
  } catch (error) {
    log.error('Search API error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });

    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, { results: [] });
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
