import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  _session: AttendanceSession,
): Promise<void> {
  if (req.method !== 'GET')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const { drNumber, step } = req.query as { drNumber: string; step: string };
  const stepNum = parseInt(step, 10);
  if (!drNumber || isNaN(stepNum)) return apiResponse.badRequest(res, 'drNumber and step required');

  const { rows } = await pool.query<{
    id: string; status: string; denial_reason: string | null;
  }>(
    `SELECT id, status, denial_reason
     FROM sitecam_appeals
     WHERE dr_number = $1 AND step_number = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [drNumber, stepNum],
  );

  if (!rows[0]) return apiResponse.success(res, { status: 'none' });

  return apiResponse.success(res, {
    appealId: rows[0].id,
    status: rows[0].status,
    denialReason: rows[0].denial_reason,
  });
}

export default withMySession(handler);
