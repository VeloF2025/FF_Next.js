/**
 * GET/POST /api/my/project — which project is the signed-in worker on today?
 *
 * GET  returns the best answer we have and whether the worker should be asked.
 * POST records their answer.
 *
 * The stores flow needs this to offer only the technicians actually on a
 * project. `staff.declared_project_id` alone is not good enough: it is written
 * once at self-registration and never refreshed, and on 2026-08-21 it disagreed
 * with the same worker's latest H&S check-in for 5 of the 15 technicians that
 * could be compared.
 *
 * So today's H&S daily check-in wins when it exists — it is asked every morning
 * and is geofenced — and a worker who already answered there is NOT asked
 * again. See lib/currentProject.ts for the precedence rules.
 *
 * Gated by the same /my session guard as every other portal endpoint, which
 * also carries the suspend check.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { resolveCurrentProject } from '@/modules/field-stock-pwa/lib/currentProject';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SignalRow extends Record<string, unknown> {
  checkin_today_project_id: string | null;
  declared_today_project_id: string | null;
  standing_declaration_project_id: string | null;
  standing_project_name: string | null;
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const staffId = session.staffId;

  if (req.method === 'GET') {
    try {
      // "Today" is deliberately the worker's local day, not UTC: a 06:00 SAST
      // check-in is 04:00 UTC and would otherwise fall on the wrong date.
      const rows = await query<SignalRow>(
        `SELECT
           (SELECT h.project_id FROM hs_daily_checkins h
             WHERE h.staff_id = $1 AND h.project_id IS NOT NULL
               AND (h.created_at AT TIME ZONE 'Africa/Johannesburg')::date
                   = (NOW() AT TIME ZONE 'Africa/Johannesburg')::date
             ORDER BY h.created_at DESC LIMIT 1) AS checkin_today_project_id,
           (SELECT s.declared_project_id FROM staff s
             WHERE s.id = $1
               AND s.declared_project_at IS NOT NULL
               AND (s.declared_project_at AT TIME ZONE 'Africa/Johannesburg')::date
                   = (NOW() AT TIME ZONE 'Africa/Johannesburg')::date) AS declared_today_project_id,
           (SELECT s.declared_project_id FROM staff s WHERE s.id = $1)
             AS standing_declaration_project_id,
           (SELECT p.project_name FROM staff s
              JOIN projects p ON p.id = s.declared_project_id
             WHERE s.id = $1) AS standing_project_name`,
        [staffId],
      );

      const r = rows[0];
      const current = resolveCurrentProject({
        checkinTodayProjectId: r?.checkin_today_project_id ?? null,
        declaredTodayProjectId: r?.declared_today_project_id ?? null,
        standingDeclarationProjectId: r?.standing_declaration_project_id ?? null,
      });

      // Options come back with the status rather than from a second endpoint:
      // /api/my/stores/projects is gated to stores actors, and the worker being
      // asked here is a technician, who is not one.
      const options = await query<{ id: string; name: string }>(
        `SELECT id, project_name AS name FROM projects
          WHERE status = 'active' ORDER BY project_name`,
      );

      return apiResponse.success(res, {
        ...current,
        // Pre-fills the picker so the common case is one tap to confirm.
        suggestedProjectName: r?.standing_project_name ?? null,
        options,
      });
    } catch (error) {
      log.error('my/project GET failed', { error }, 'my/project');
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    const projectId = (req.body ?? {}).projectId as unknown;
    if (typeof projectId !== 'string' || !UUID.test(projectId)) {
      return apiResponse.validationError(res, { projectId: 'A valid project id is required' });
    }

    try {
      // Reject an unknown or archived project rather than storing a dangling id.
      const ok = await query<{ id: string }>(
        `SELECT id FROM projects WHERE id = $1`,
        [projectId],
      );
      if (ok.length === 0) {
        return apiResponse.validationError(res, { projectId: 'Unknown project' });
      }

      await query(
        `UPDATE staff SET declared_project_id = $1, declared_project_at = NOW() WHERE id = $2`,
        [projectId, staffId],
      );
      log.info('worker declared their project', { staffId, projectId }, 'my/project');
      return apiResponse.success(res, { projectId, source: 'declared-today', shouldAsk: false });
    } catch (error) {
      log.error('my/project POST failed', { error }, 'my/project');
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
});
