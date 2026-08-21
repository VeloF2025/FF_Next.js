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
  has_ever_checked_in: boolean;
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
             WHERE s.id = $1) AS standing_project_name,
           EXISTS (SELECT 1 FROM hs_daily_checkins h
                    WHERE h.staff_id = $1 AND h.project_id IS NOT NULL)
             AS has_ever_checked_in`,
        [staffId],
      );

      const r = rows[0];
      const current = resolveCurrentProject({
        checkinTodayProjectId: r?.checkin_today_project_id ?? null,
        declaredTodayProjectId: r?.declared_today_project_id ?? null,
        standingDeclarationProjectId: r?.standing_declaration_project_id ?? null,
        hasEverCheckedInOnProject: r?.has_ever_checked_in === true,
      });

      // Skip the option list entirely for someone who will not be asked — the
      // shell calls this on every /my page for every role, and most callers are
      // office staff who need nothing back.
      //
      // Options come back with the status rather than from a second endpoint:
      // /api/my/stores/projects is gated to stores actors, and a field worker
      // is not one.
      const options = current.shouldAsk
        ? await query<{ id: string; name: string }>(
            `SELECT id, project_name AS name FROM projects
              WHERE status = 'active' ORDER BY project_name`,
          )
        : [];

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

      // Refuse a declaration from someone who does no field work. Without this
      // any /my user could write into the field the stores flow reads, and the
      // GET is only advisory — a client can always POST directly.
      const evidence = await query<{ ok: boolean }>(
        `SELECT (EXISTS (SELECT 1 FROM hs_daily_checkins h
                          WHERE h.staff_id = $1 AND h.project_id IS NOT NULL)
                 OR EXISTS (SELECT 1 FROM staff s
                             WHERE s.id = $1 AND s.declared_project_id IS NOT NULL)) AS ok`,
        [staffId],
      );
      if (evidence[0]?.ok !== true) {
        log.warn('project declaration refused: no field-work evidence', { staffId }, 'my/project');
        return apiResponse.validationError(res, {
          projectId: 'Only field staff declare a project',
        });
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
