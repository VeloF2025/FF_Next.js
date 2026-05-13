import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

interface PonRow {
  pon_no: number;
  pole_count: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id } = req.query;
  if (!project_id || typeof project_id !== 'string') {
    return apiResponse.badRequest(res, 'project_id required');
  }

  try {
    const result = await pool.query<PonRow>(`
      WITH pon_pool AS (
        SELECT DISTINCT pon_no, feature_id AS pole_label
        FROM qfield_photo_validations
        WHERE project_id = $1::uuid
          AND feature_type = 'pole'
          AND pon_no IS NOT NULL
        UNION
        SELECT DISTINCT pon_no, pole_label
        FROM pole_qa_photos
        WHERE project_id = $1::uuid
          AND pon_no IS NOT NULL
      )
      SELECT pon_no, COUNT(DISTINCT pole_label)::int AS pole_count
      FROM pon_pool
      GROUP BY pon_no
      ORDER BY pon_no ASC
    `, [project_id]);

    return apiResponse.success(res, result.rows);
  } catch (err) {
    log.error('works-qa/pons', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
