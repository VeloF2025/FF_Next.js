/**
 * PON Tracker API
 * GET  /api/projects/[projectId]/tracker  - Fetch tracker rows
 * POST /api/projects/[projectId]/tracker  - Save tracker rows (stub)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const { projectId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Missing projectId');
  }

  if (req.method === 'GET') {
    try {
      // Stub: return empty array until DB table is created
      return apiResponse.success(res, []);
    } catch (err) {
      log.error('Failed to fetch tracker rows', { err, projectId }, 'tracker.ts');
      return apiResponse.internalError(res, 'Failed to fetch tracker data');
    }
  }

  if (req.method === 'POST') {
    try {
      const { rows } = req.body as { rows?: unknown[] };
      if (!Array.isArray(rows)) {
        return apiResponse.badRequest(res, 'rows must be an array');
      }
      // Stub: echo back the submitted rows
      log.info('Tracker save stub', { projectId, count: rows.length }, 'tracker.ts');
      return apiResponse.success(res, rows);
    } catch (err) {
      log.error('Failed to save tracker rows', { err, projectId }, 'tracker.ts');
      return apiResponse.internalError(res, 'Failed to save tracker data');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
}

export default withAuth(handler);
