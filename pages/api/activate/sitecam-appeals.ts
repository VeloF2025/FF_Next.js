import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const statusFilter = (req.query.status as string) || 'pending';
  if (!['pending', 'approved', 'denied'].includes(statusFilter))
    return apiResponse.badRequest(res, 'status must be pending, approved or denied');

  const { rows } = await pool.query(
    `SELECT a.id, a.dr_number, a.step_number, a.appeal_text, a.photo_url,
            a.serial_scanned, a.serial_expected, a.attempt_number,
            a.status, a.decided_via, a.decided_at, a.denial_reason, a.created_at,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM sitecam_appeals a
     LEFT JOIN staff s ON s.id = a.technician_id
     WHERE a.status = $1
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [statusFilter],
  );

  return apiResponse.success(res, { appeals: rows });
}

export default withAuth(withRole('manager')(handler));
