/**
 * GET /api/reporting/attendance?mode=person|roster|exceptions&person=…&since=…&until=…
 *
 * Attendance for staff and field workers: who worked when, how many hours, and which days
 * are flagged for review. Hours only — no pay, no GPS, no selfies; see the header of
 * lib/reporting/attendance.ts for why those three are structurally excluded.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { parseAttendanceFilter } from '@/lib/reporting/attendanceFilter';
import {
  attendanceQuery,
  shapeAttendance,
  type AttendanceDayRow,
} from '@/lib/reporting/attendance';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const parsed = parseAttendanceFilter(req.query);
  if ('error' in parsed) return apiResponse.badRequest(res, parsed.error);

  try {
    const { sql, params } = attendanceQuery(parsed.filter);
    const result = await pool.query<AttendanceDayRow>(sql, params);

    // Attendance is staff personal information: never cached anywhere shared.
    res.setHeader('Cache-Control', 'private, no-store');
    return apiResponse.success(res, shapeAttendance(result.rows, parsed.filter));
  } catch (error) {
    log.error(
      'Attendance report failed',
      { module: 'reporting-attendance', mode: parsed.filter.mode, error: (error as Error).message },
      'reporting-attendance',
    );
    return apiResponse.internalError(res, new Error('Attendance report failed'));
  }
}

// `people.staff.attendance.search` — the key the existing attendance-search route uses,
// queried against access_permissions rather than assumed. It admits manager (15),
// super_admin (10) and admin (6): 31 of 95 active users. Deliberately NOT
// `people.staff.tabs.attendance`, which additionally grants 52 viewers — this returns
// named people's working hours across the whole workforce, which is a narrower thing than
// the per-staff-member tab that key exists for.
export default withAuth(withPermission('people.staff.attendance.search', 'view')(handler));
