import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

const MODULE = 'sitecam-appeal-decision';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { id } = req.query as { id: string };
  const { decision, denialReason } = req.body as { decision: 'approved' | 'denied'; denialReason?: string };

  if (!id) return apiResponse.badRequest(res, 'appeal id required');
  if (decision !== 'approved' && decision !== 'denied')
    return apiResponse.badRequest(res, 'decision must be approved or denied');

  const decidedBy = (req as AuthenticatedNextApiRequest).user.id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ dr_number: string; step_number: number }>(
      `UPDATE sitecam_appeals
       SET status = $1,
           decided_by = $2,
           decided_via = 'in_app',
           decided_at = now(),
           denial_reason = $3,
           human_agreed_with_vlm = CASE
             WHEN vlm_recommendation IS NULL OR vlm_recommendation = 'uncertain' THEN NULL
             WHEN vlm_recommendation = 'approve' AND $1 = 'approved' THEN true
             WHEN vlm_recommendation = 'deny'    AND $1 = 'denied'   THEN true
             ELSE false
           END
       WHERE id = $4
       RETURNING dr_number, step_number`,
      [decision, decidedBy, denialReason ?? null, id],
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return apiResponse.notFound(res, 'Appeal', id);
    }

    await client.query('COMMIT');
    log.info('Appeal decision recorded', { id, decision }, MODULE);
    return apiResponse.success(res, { ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
