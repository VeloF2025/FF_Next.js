/**
 * Project Import Status API
 * PRD-047: Get import status/counts for a project
 *
 * GET /api/project-import/status?projectId=xxx
 *
 * Returns counts of imported drops, poles, and fibre for a project
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuth } from '@/lib/auth-mock';
import { withAuth } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getProjectImportStatus } from '@/services/project-import';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId } = getAuth(req);
  if (!userId) {
    return apiResponse.unauthorized(res);
  }

  try {
    const { projectId } = req.query;

    if (!projectId || typeof projectId !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'projectId query parameter is required');
    }

    log.info(`Getting import status for project ${projectId}`, {}, 'project-import-api');

    const status = await getProjectImportStatus(projectId);

    return apiResponse.success(res, {
      projectId,
      counts: status,
      total: status.drops + status.poles + status.fibre,
      hasData: status.drops > 0 || status.poles > 0 || status.fibre > 0,
    });
  } catch (error) {
    const err = error as Error;
    log.error(`Failed to get import status`, {
      data: { error: err.message },
    }, 'project-import-api');

    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
