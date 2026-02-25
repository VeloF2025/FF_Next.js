/**
 * EXFO Exchange Sync API
 *
 * POST /api/exfo/sync — Trigger sync for one or all workspaces
 *   Body: { workspaceId?, full?, fetchDetails? }
 *
 * GET /api/exfo/sync — Get sync history
 *   ?workspaceId=xxx&limit=20
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { syncWorkspace, syncAllWorkspaces, getSyncConfigs } from '@/services/exfo';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return handleSync(req, res);
  }

  if (req.method === 'GET') {
    return handleGetHistory(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST']);
}

async function handleSync(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { workspaceId, full, fetchDetails } = req.body || {};

    if (workspaceId) {
      const configs = await getSyncConfigs();
      const config = configs.find(c => c.workspace_id === workspaceId);

      if (!config) {
        return apiResponse.notFound(res, 'EXFO workspace config', workspaceId);
      }

      const result = await syncWorkspace(config, { full, fetchDetails });
      return apiResponse.success(res, result);
    }

    const results = await syncAllWorkspaces({ full, fetchDetails });
    return apiResponse.success(res, results);
  } catch (err) {
    return apiResponse.internalError(res, err);
  }
}

async function handleGetHistory(req: NextApiRequest, res: NextApiResponse) {
  try {
    const workspaceId = req.query.workspaceId as string || '';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string || '20', 10)));

    let rows;
    if (workspaceId) {
      rows = await sql`
        SELECT * FROM exfo_sync_history
        WHERE workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * FROM exfo_sync_history
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
    }

    return apiResponse.success(res, { history: rows });
  } catch (err) {
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
