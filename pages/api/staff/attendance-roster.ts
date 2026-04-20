/**
 * GET /api/staff/attendance-roster?date=YYYY-MM-DD
 *
 * Today's roster for supervisors: one row per staff member with their
 * latest entry state for that work_date. Default date = today in SAST.
 *
 * Categorisation:
 *   - 'on_shift'   — open entry, clock_in_at on the requested work_date
 *   - 'clocked_out' — closed entry, clock_in_at on the requested work_date
 *   - 'absent'     — no entry at all on the requested work_date
 *   - 'exception'  — entry has one or more unresolved exceptions
 *
 * RBAC: `people.staff.attendance.manage`.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withAuth, withPermission } from '@/lib/auth/middleware';

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

interface RosterRow extends Record<string, unknown> {
  staff_id: string;
  full_name: string;
  phone: string | null;
  home_site_id: string | null;
  home_site_name: string | null;
  entry_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  status: string | null;
  open_exception_count: number;
  site_name: string | null;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const dateParam = typeof req.query.date === 'string' ? req.query.date : '';
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayInSast();

  try {
    const rows = await sql<RosterRow>`
      WITH day_entries AS (
        SELECT DISTINCT ON (e.staff_id)
          e.staff_id,
          e.id AS entry_id,
          e.clock_in_at,
          e.clock_out_at,
          e.status,
          e.site_geofence_id,
          (
            SELECT COUNT(*) FROM attendance_exceptions x
            WHERE x.entry_id = e.id AND x.resolved_at IS NULL
          )::int AS open_exception_count
        FROM attendance_entries e
        WHERE e.work_date = ${workDate}::date
        ORDER BY e.staff_id, e.clock_in_at DESC
      )
      SELECT
        s.id AS staff_id,
        TRIM(COALESCE(s.first_name, '') || ' ' || COALESCE(s.last_name, '')) AS full_name,
        s.phone,
        s.home_site_id,
        home_site.name AS home_site_name,
        d.entry_id, d.clock_in_at, d.clock_out_at, d.status,
        COALESCE(d.open_exception_count, 0) AS open_exception_count,
        entry_site.name AS site_name
      FROM staff s
      LEFT JOIN day_entries d ON d.staff_id = s.id
      LEFT JOIN fleet_authorized_locations home_site ON home_site.id = s.home_site_id
      LEFT JOIN fleet_authorized_locations entry_site ON entry_site.id = d.site_geofence_id
      WHERE LOWER(s.status) = 'active'
      ORDER BY full_name ASC
    `;

    const roster = rows.map((r) => {
      // Branch on entry_id FIRST. A row where `entry_id IS NULL` genuinely
      // has no entry for this work_date — that's the only 'absent' case.
      // A row with an `entry_id` but `status IS NULL` is a data-integrity
      // bug (partial insert, legacy row, migration gap) and must NOT be
      // silently bucketed as 'absent' — that would hide the fact that the
      // person clocked in. Surface via a warning log so ops can repair.
      let category: 'on_shift' | 'clocked_out' | 'absent' | 'exception';
      if (r.open_exception_count > 0) {
        category = 'exception';
      } else if (r.entry_id == null) {
        category = 'absent';
      } else if (r.status === 'open') {
        category = 'on_shift';
      } else if (r.status) {
        category = 'clocked_out';
      } else {
        log.warn('[staff-attendance-roster] entry with NULL status — treating as exception', {
          entryId: r.entry_id, staffId: r.staff_id, workDate,
        });
        category = 'exception';
      }
      return {
        staffId: r.staff_id,
        name: r.full_name,
        phone: r.phone,
        homeSiteId: r.home_site_id,
        homeSiteName: r.home_site_name,
        entryId: r.entry_id,
        clockInAt: r.clock_in_at,
        clockOutAt: r.clock_out_at,
        siteName: r.site_name,
        status: r.status,
        openExceptionCount: r.open_exception_count,
        category,
      };
    });

    const summary = {
      total: roster.length,
      onShift: roster.filter((r) => r.category === 'on_shift').length,
      clockedOut: roster.filter((r) => r.category === 'clocked_out').length,
      absent: roster.filter((r) => r.category === 'absent').length,
      exceptions: roster.filter((r) => r.category === 'exception').length,
    };

    return apiResponse.success(res, { workDate, roster, summary });
  } catch (err) {
    log.error('[staff-attendance-roster] unexpected error', {
      workDate,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.manage', 'view')(handler));
