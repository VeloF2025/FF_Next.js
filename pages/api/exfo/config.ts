/**
 * EXFO Sync Config API
 *
 * GET /api/exfo/config — List workspace configs
 * POST /api/exfo/config — Create/update workspace config
 * DELETE /api/exfo/config — Delete workspace config (body: { id })
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handleUpsert(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);

  return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST', 'DELETE']);
}

async function handleGet(_req: NextApiRequest, res: NextApiResponse) {
  try {
    const configs = await sql`
      SELECT
        c.*,
        p.project_name,
        (SELECT COUNT(*) FROM exfo_test_results r WHERE r.exfo_workspace_id = c.workspace_id) as result_count,
        (SELECT MAX(started_at) FROM exfo_sync_history h WHERE h.workspace_id = c.workspace_id AND h.status = 'completed') as last_successful_sync
      FROM exfo_sync_config c
      LEFT JOIN projects p ON p.id = c.project_id
      ORDER BY c.workspace_name
    `;

    return apiResponse.success(res, { configs });
  } catch (err) {
    return apiResponse.internalError(res, err);
  }
}

async function handleUpsert(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { workspace_id, workspace_name, org_id, is_active, sync_interval_minutes, project_id } = req.body;

    if (!workspace_id || !workspace_name) {
      return apiResponse.badRequest(res, 'workspace_id and workspace_name are required');
    }

    const orgId = org_id || process.env.EXFO_ORG_ID || '72712';
    const active = is_active !== false;
    const interval = sync_interval_minutes || 60;

    const rows = await sql`
      INSERT INTO exfo_sync_config (workspace_id, workspace_name, org_id, is_active, sync_interval_minutes, project_id)
      VALUES (${workspace_id}, ${workspace_name}, ${orgId}, ${active}, ${interval}, ${project_id || null}::UUID)
      ON CONFLICT (workspace_id) DO UPDATE SET
        workspace_name = EXCLUDED.workspace_name,
        org_id = EXCLUDED.org_id,
        is_active = EXCLUDED.is_active,
        sync_interval_minutes = EXCLUDED.sync_interval_minutes,
        project_id = EXCLUDED.project_id,
        updated_at = NOW()
      RETURNING *
    `;

    return apiResponse.success(res, rows[0]);
  } catch (err) {
    return apiResponse.internalError(res, err);
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { id } = req.body;
    if (!id) {
      return apiResponse.badRequest(res, 'id is required');
    }

    await sql`DELETE FROM exfo_sync_config WHERE id = ${id}::UUID`;
    return apiResponse.success(res, { deleted: true });
  } catch (err) {
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
