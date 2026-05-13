import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { pole_id } = req.query;
  if (!pole_id || typeof pole_id !== 'string') return apiResponse.badRequest(res, 'pole_id required');

  try {
    const result = await pool.query(
      'SELECT * FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (result.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);
    return apiResponse.success(res, result.rows[0]);
  } catch (err) {
    log.error('works-qa/pole-detail', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
