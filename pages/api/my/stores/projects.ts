/**
 * GET /api/my/stores/projects — active projects for the /my stores PWA issue wizard.
 *
 * The issue wizard stamps stock_pickings.project_id so the Accountability report
 * can break held stock down per project. There is no existing /my-safe project
 * source (the main /api/projects route is withAuth/main-RBAC), so this is the
 * stores-scoped equivalent: withMySession + requireStoresActor, pg.Pool.
 *
 * Terminal-status projects (completed/cancelled/archived) are excluded — you do
 * not issue field stock against a closed project. Optional ?search filters by
 * name/code (case-insensitive).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';

const TERMINAL_STATUSES = ['completed', 'cancelled', 'archived'];

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { search } = req.query as { search?: string };

  const rows = search
    ? await sql`
        SELECT id, project_name, project_code, status
        FROM projects
        WHERE COALESCE(status, '') <> ALL(${TERMINAL_STATUSES})
          AND (project_name ILIKE ${'%' + search + '%'}
            OR project_code ILIKE ${'%' + search + '%'})
        ORDER BY project_name
        LIMIT 200
      `
    : await sql`
        SELECT id, project_name, project_code, status
        FROM projects
        WHERE COALESCE(status, '') <> ALL(${TERMINAL_STATUSES})
        ORDER BY project_name
        LIMIT 200
      `;

  return apiResponse.success(res, rows);
}

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  } catch (error) {
    log.error('my-stores projects API error', { error }, 'my/stores/projects');
    return apiResponse.internalError(res, error);
  }
});
