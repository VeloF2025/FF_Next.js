import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

// "Mark caught up" for the Works QA Recent feed — force the caller's
// "since I last opened" watermark to now, clearing the feed deliberately.
// Auto-advance on open is handled by GET /api/works-qa/recent (debounced);
// this endpoint is the explicit, immediate reset.

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const email = (req as AuthenticatedNextApiRequest).user.email;

  try {
    const { rows } = await pool.query<{ cutoff_at: string }>(
      `INSERT INTO works_qa_view_watermark (user_email, cutoff_at, last_active_at)
       VALUES ($1, NOW(), NOW())
       ON CONFLICT (user_email) DO UPDATE SET
         cutoff_at = NOW(),
         last_active_at = NOW(),
         updated_at = NOW()
       RETURNING cutoff_at`,
      [email],
    );
    return apiResponse.success(res, { cutoffAt: rows[0]!.cutoff_at });
  } catch (err) {
    log.error('works-qa/recent-seen', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
