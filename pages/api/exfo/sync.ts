/**
 * EXFO Exchange Sync API
 *
 * POST /api/exfo/sync — Trigger sync for one or all workspaces
 *   Body: { workspaceId?, full?, fetchDetails? }
 *   Auth: session cookie OR x-cron-secret header (for cron jobs)
 *
 * GET /api/exfo/sync — Get sync history (session auth only)
 *   ?workspaceId=xxx&limit=20
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { createLogger } from '@/lib/logger';
import { syncWorkspace, syncAllWorkspaces, getSyncConfigs } from '@/services/exfo';

const logger = createLogger('api:exfo:sync');
const sql = neon(process.env.DATABASE_URL!);

/**
 * Check if request is authenticated via cron secret header.
 */
function hasCronSecret(req: NextApiRequest): boolean {
  const cronSecret = req.headers['x-cron-secret'];
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  return cronSecret === expectedSecret;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return handleSync(req, res);
  }

  if (req.method === 'GET') {
    return handleGetHistory(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST']);
}

/**
 * POST handler — accepts both session auth (via withAuth wrapper) and cron secret.
 * The cron secret path is checked in the exported default below.
 */

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
    log.error('exfo-sync', { error: err instanceof Error ? err.message : String(err) });
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
        SELECT * /* TODO: specify columns */ FROM exfo_sync_history
        WHERE workspace_id = ${workspaceId}
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
    } else {
      rows = await sql`
        SELECT * /* TODO: specify columns */ FROM exfo_sync_history
        ORDER BY started_at DESC
        LIMIT ${limit}
      `;
    }

    return apiResponse.success(res, { history: rows });
  } catch (err) {
    log.error('exfo-sync', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

/**
 * Allow POST with cron secret header to bypass session auth.
 * GET (history) still requires session auth.
 */
async function authGate(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST' && hasCronSecret(req)) {
    logger.info('EXFO sync triggered via cron secret');
    return handler(req, res);
  }

  // Fall through to session auth for all other requests
  return withAuth(handler)(req, res);
}

export default authGate;
