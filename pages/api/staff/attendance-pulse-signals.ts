/**
 * GET /api/staff/attendance-pulse-signals
 *
 * Returns three Pulse-sourced counts for /activate/action-centre's Overview
 * tab (PRD-061 Phase E, FR-ACTION-01..04):
 *
 *   - pendingCorrections : attendance_adjustments where status='pending',
 *                          scope-narrowed to the viewer's reports.
 *   - openExceptions7d   : unresolved attendance_exceptions whose entry's
 *                          work_date is in the last 7 calendar days (SAST).
 *   - noShowAlerts3d     : count of active staff with zero attendance_entries
 *                          in the last 3 calendar days (SAST). The
 *                          threshold N is server-config (FR-ACTION-04).
 *
 * Scope (FR-ACTION-COM, mirroring Phase A): super_admin / admin always
 * org-wide; every other role narrowed to `staffIdsSupervisedBy(viewerStaffId)`.
 *
 * RBAC: reuses `people.staff.attendance.search` (Phase A). No new key.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { sql } from '@/lib/db-pool';
import { resolveScope, type ResolvedScope } from '@/services/attendance/searchQueries';

/** No-show threshold in calendar days. Server-config per FR-ACTION-04. */
const NO_SHOW_THRESHOLD_DAYS = 3;

/** Open-exceptions window in calendar days. */
const OPEN_EXCEPTIONS_WINDOW_DAYS = 7;

interface PulseSignals {
  pendingCorrections: number;
  openExceptions7d: number;
  noShowAlerts3d: number;
  threshold: { noShowDays: number; openExceptionsDays: number };
}

function todayInSast(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function countPendingCorrections(scope: ResolvedScope): Promise<number> {
  // attendance_adjustments.requested_by is the staff who SUBMITTED, but
  // scope is judged on the entry's staff_id (who the correction is about).
  // A manager should see corrections for their reports, regardless of who
  // submitted them — and a staff member should still see their own.
  if (scope.allowedStaffIds === null) {
    const rows = await sql<{ count: number }>`
      SELECT COUNT(*)::int AS count
      FROM attendance_adjustments adj
      WHERE adj.status = 'pending'
    `;
    return rows[0]?.count ?? 0;
  }
  if (scope.allowedStaffIds.length === 0) return 0;
  const rows = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count
    FROM attendance_adjustments adj
    JOIN attendance_entries e ON e.id = adj.entry_id
    WHERE adj.status = 'pending'
      AND e.staff_id = ANY(${scope.allowedStaffIds}::uuid[])
  `;
  return rows[0]?.count ?? 0;
}

async function countOpenExceptions(scope: ResolvedScope, today: string): Promise<number> {
  const since = addDays(today, -(OPEN_EXCEPTIONS_WINDOW_DAYS - 1));
  if (scope.allowedStaffIds === null) {
    const rows = await sql<{ count: number }>`
      SELECT COUNT(*)::int AS count
      FROM attendance_exceptions x
      JOIN attendance_entries xe ON xe.id = x.entry_id
      WHERE x.resolved_at IS NULL
        AND xe.work_date >= ${since}::date
        AND xe.work_date <= ${today}::date
    `;
    return rows[0]?.count ?? 0;
  }
  if (scope.allowedStaffIds.length === 0) return 0;
  const rows = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count
    FROM attendance_exceptions x
    JOIN attendance_entries xe ON xe.id = x.entry_id
    WHERE x.resolved_at IS NULL
      AND xe.work_date >= ${since}::date
      AND xe.work_date <= ${today}::date
      AND xe.staff_id = ANY(${scope.allowedStaffIds}::uuid[])
  `;
  return rows[0]?.count ?? 0;
}

async function countNoShowAlerts(scope: ResolvedScope, today: string): Promise<number> {
  const since = addDays(today, -(NO_SHOW_THRESHOLD_DAYS - 1));
  // Active = is_active = true (or NULL — historical default) AND end_date IS NULL.
  // No-show = no attendance_entries in [since, today].
  if (scope.allowedStaffIds === null) {
    const rows = await sql<{ count: number }>`
      SELECT COUNT(*)::int AS count
      FROM staff s
      WHERE (s.is_active = true OR s.is_active IS NULL)
        AND s.end_date IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM attendance_entries e
          WHERE e.staff_id = s.id
            AND e.work_date >= ${since}::date
            AND e.work_date <= ${today}::date
        )
    `;
    return rows[0]?.count ?? 0;
  }
  if (scope.allowedStaffIds.length === 0) return 0;
  const rows = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count
    FROM staff s
    WHERE s.id = ANY(${scope.allowedStaffIds}::uuid[])
      AND (s.is_active = true OR s.is_active IS NULL)
      AND s.end_date IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM attendance_entries e
        WHERE e.staff_id = s.id
          AND e.work_date >= ${since}::date
          AND e.work_date <= ${today}::date
      )
  `;
  return rows[0]?.count ?? 0;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    return;
  }
  const user = (req as AuthenticatedNextApiRequest).user;
  if (!user?.id) {
    apiResponse.unauthorized(res);
    return;
  }
  try {
    const scope = await resolveScope(user);
    const today = todayInSast();
    // Three independent queries — run in parallel; pg pool handles them
    // on separate connections. Keeps the action-centre overview snappy.
    const [pendingCorrections, openExceptions7d, noShowAlerts3d] = await Promise.all([
      countPendingCorrections(scope),
      countOpenExceptions(scope, today),
      countNoShowAlerts(scope, today),
    ]);
    const payload: PulseSignals = {
      pendingCorrections,
      openExceptions7d,
      noShowAlerts3d,
      threshold: {
        noShowDays: NO_SHOW_THRESHOLD_DAYS,
        openExceptionsDays: OPEN_EXCEPTIONS_WINDOW_DAYS,
      },
    };
    apiResponse.success(res, payload);
  } catch (err) {
    log.error('[attendance-pulse-signals] failed', {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.search', 'view')(handler)
);
