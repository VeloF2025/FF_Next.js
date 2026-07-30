import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { generateRequestId } from '@/lib/observability/requestId';
import {
  getProjectStats,
  parseProjectStatsQuery,
  ProjectStatsError,
} from '@/modules/qfield-sync/project-stats';

const requestIdKey = Symbol('qfieldProjectStatsRequestId');

type RequestWithRequestId = NextApiRequest & {
  [requestIdKey]?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIdFor(req: NextApiRequest, res: NextApiResponse): string {
  const request = req as RequestWithRequestId;
  const requestId = request[requestIdKey] ?? generateRequestId();
  request[requestIdKey] = requestId;
  res.setHeader('X-Request-Id', requestId);
  return requestId;
}

function withProjectStatsRequestId(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const requestId = requestIdFor(req, res);
    const sendJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      if (!isRecord(body)) return sendJson(body);
      const meta = isRecord(body.meta) ? body.meta : {};
      return sendJson({ ...body, meta: { ...meta, requestId } });
    }) as typeof res.json;
    return handler(req, res);
  };
}

export async function projectStatsHandler(req: NextApiRequest, res: NextApiResponse) {
  const requestId = requestIdFor(req, res);

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

export default withProjectStatsRequestId(
  withAuth(withPermission('projects', 'view')(projectStatsHandler))
);
