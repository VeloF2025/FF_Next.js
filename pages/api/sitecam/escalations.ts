/**
 * GET /api/sitecam/escalations
 *
 * Returns pending (or filtered) PWA escalations for the supervisor view.
 * Query param: status = 'pending' | 'approved' | 'rejected' (default: 'pending')
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const status = (req.query['status'] as string) ?? 'pending';
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return apiResponse.badRequest(res, 'status must be pending, approved, or rejected');
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.job_type, e.site_id, e.step_number,
            e.fail_reasons, e.attempt_photos, e.status,
            e.created_at, e.resolved_at, e.resolution_note,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM pwa_escalations e
     LEFT JOIN staff s ON s.id = e.tech_id
     WHERE e.status = $1
     ORDER BY e.created_at DESC
     LIMIT 100`,
    [status]
  );

  return apiResponse.success(res, { escalations: rows });
}

// Supervisor-only: viewing the escalation queue requires manager role or higher.
export default withAuth(withRole('manager')(handler));
