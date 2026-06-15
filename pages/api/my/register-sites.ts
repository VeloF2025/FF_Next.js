/**
 * GET /api/my/register-sites — PUBLIC, unauthenticated.
 *
 * Minimal { id, name } project list for the self-registration site picker
 * (the /my/register page has no session yet, so it cannot use the withAuth-gated
 * /api/projects routes). Only id + name are exposed — low sensitivity by design.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    const rows = await sql<{ id: string; name: string }>`
      SELECT id, project_name AS name
      FROM projects
      WHERE project_name IS NOT NULL
        AND LOWER(COALESCE(status, '')) NOT IN ('closed', 'archived', 'completed', 'cancelled')
      ORDER BY project_name
      LIMIT 500
    `;
    return apiResponse.success(res, { sites: rows });
  } catch (err) {
    log.error('[my-register-sites] query failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
