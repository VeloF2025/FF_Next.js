import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { allGatesPass } from '@/modules/works-qa/utils/approval-gates';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id } = req.body as { pole_id?: string };
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');

  try {
    const userEmail = (req as AuthenticatedNextApiRequest).user.email;

    const fetchResult = await pool.query(
      'SELECT * FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (fetchResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    const pole = fetchResult.rows[0] as PoleQaPhoto;
    const { pass, blocking } = allGatesPass(pole);

    if (!pass) {
      return res.status(422).json({ success: false, error: 'Approval gates failed', blocking });
    }

    await pool.query(`
      UPDATE pole_qa_photos
      SET civil_approved = TRUE, dome_approved = TRUE, joint_approved = TRUE,
          approved_by = $1, approved_at = NOW(), updated_at = NOW()
      WHERE id = $2::uuid
    `, [userEmail, pole_id]);

    return apiResponse.success(res, { approved: true });
  } catch (err) {
    log.error('works-qa/pole-approve', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withRole('manager')(handler));
