import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { AttendancePeriodError, getPeriodReadiness } from '@/modules/attendance/workflow/periodQueries';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    return;
  }
  const week = typeof req.query.week_start_date === 'string' ? req.query.week_start_date : '';
  if (!week) {
    apiResponse.badRequest(res, 'week_start_date is required');
    return;
  }
  try {
    apiResponse.success(res, await getPeriodReadiness(week));
  } catch (error) {
    if (error instanceof AttendancePeriodError && error.code === 'invalid_week') {
      apiResponse.badRequest(res, error.message, { reason: error.code });
      return;
    }
    log.error('[staff-attendance-period-readiness] read failed', {
      weekStartDate: week,
      error: error instanceof Error ? error.message : String(error),
    });
    apiResponse.internalError(res, error);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.locks', 'view')(handler)
);
