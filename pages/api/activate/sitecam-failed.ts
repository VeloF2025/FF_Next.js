/**
 * GET /api/activate/sitecam-failed?status=pending|resolved
 *
 * Lists pwa_escalations — SiteCam steps that failed VLM validation 3 times.
 * Feeds the "Failed" tab on the SiteCam Appeals page.
 * status=resolved returns both approved and rejected escalations.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const statusFilter = (req.query.status as string) || 'pending';
  if (!['pending', 'resolved'].includes(statusFilter))
    return apiResponse.badRequest(res, 'status must be pending or resolved');

  const statuses = statusFilter === 'pending' ? ['pending'] : ['approved', 'rejected'];

  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.job_type, e.site_id, e.step_number,
              e.fail_reasons, e.attempt_photos, e.status,
              e.resolved_at, e.resolution_note, e.created_at,
              t.first_name || ' ' || t.last_name AS tech_name,
              r.first_name || ' ' || r.last_name AS resolved_by_name
       FROM pwa_escalations e
       LEFT JOIN staff t ON t.id = e.tech_id
       LEFT JOIN staff r ON r.id = e.resolved_by
       WHERE e.status = ANY($1)
       ORDER BY e.created_at DESC
       LIMIT 100`,
      [statuses],
    );

    return apiResponse.success(res, { escalations: rows });
  } catch (err) {
    log.error('Failed to list pwa_escalations', { err: String(err) }, 'sitecam-failed');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withRole('manager')(handler));
