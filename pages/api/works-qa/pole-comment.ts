/**
 * POST /api/works-qa/pole-comment
 *
 * Append a comment to a pole's audit trail for a specific discipline.
 * Comments are append-only — never overwrites; previous comments stay visible.
 *
 * Body: { pole_id, discipline: 'civil'|'dome'|'main_joint', comment }
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

const DISCIPLINES = new Set(['civil', 'dome', 'main_joint']);
const MAX_COMMENT_LENGTH = 2000;

interface CommentBody {
  pole_id?: string;
  discipline?: string;
  comment?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, discipline, comment } = req.body as CommentBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');
  if (!discipline || !DISCIPLINES.has(discipline)) {
    return apiResponse.badRequest(res, "discipline must be one of 'civil', 'dome', 'main_joint'");
  }
  if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
    return apiResponse.badRequest(res, 'comment must be a non-empty string');
  }
  const trimmed = comment.trim();
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return apiResponse.badRequest(res, `comment exceeds ${MAX_COMMENT_LENGTH} character limit`);
  }

  const userEmail = (req as AuthenticatedNextApiRequest).user.email;

  try {
    const poleCheck = await pool.query<{ id: string }>(
      'SELECT id FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (poleCheck.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    const insertResult = await pool.query<{
      id: string;
      discipline: string;
      comment: string;
      created_by: string;
      created_at: string;
    }>(
      `INSERT INTO pole_qa_comments (pole_qa_id, discipline, comment, created_by)
       VALUES ($1::uuid, $2, $3, $4)
       RETURNING id, discipline, comment, created_by, created_at`,
      [pole_id, discipline, trimmed, userEmail],
    );

    return apiResponse.success(res, insertResult.rows[0]);
  } catch (err) {
    log.error('works-qa/pole-comment', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'create')(handler));
