import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { generateRequestId } from '@/lib/observability/requestId';
import {
  getProjectStats,
  parseProjectStatsQuery,
  ProjectStatsError,
} from '@/modules/qfield-sync/project-stats';

export async function projectStatsHandler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = generateRequestId();
  res.setHeader('X-Request-Id', requestId);

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'unknown', ['GET']);
  }

  try {
    const query = parseProjectStatsQuery(req.query);
    const user = (req as AuthenticatedNextApiRequest).user;
    const result = await getProjectStats(query, {
      userId: user.id,
      userEmail: user.email,
      requestId,
    });

    return apiResponse.success(res, result, undefined, 200, { requestId });
  } catch (error) {
    if (error instanceof ProjectStatsError) {
      return apiResponse.error(res, error.code, error.message, error.details, { requestId });
    }

    log.error(
      'QField project statistics request failed',
      {
        requestId,
        errorType: error instanceof Error ? error.name : typeof error,
      },
      'qfield-project-stats-api'
    );
    return apiResponse.error(
      res,
      ErrorCode.INTERNAL_ERROR,
      'QField project statistics request failed',
      undefined,
      { requestId }
    );
  }
}

export default withAuth(withPermission('projects', 'view')(projectStatsHandler));
