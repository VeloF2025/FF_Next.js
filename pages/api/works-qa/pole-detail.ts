import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { PoleQaComment } from '@/modules/works-qa/types/works-qa.types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { pole_id } = req.query;
  if (!pole_id || typeof pole_id !== 'string') return apiResponse.badRequest(res, 'pole_id required');

  try {
    const [poleResult, commentsResult] = await Promise.all([
      pool.query('SELECT * FROM pole_qa_photos WHERE id = $1::uuid', [pole_id]),
      pool.query<PoleQaComment>(
        `SELECT id, discipline, comment, created_by, created_at
         FROM pole_qa_comments
         WHERE pole_qa_id = $1::uuid
         ORDER BY created_at ASC`,
        [pole_id],
      ),
    ]);
    if (poleResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    return apiResponse.success(res, {
      ...poleResult.rows[0],
      comments: commentsResult.rows,
    });
  } catch (err) {
    log.error('works-qa/pole-detail', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
