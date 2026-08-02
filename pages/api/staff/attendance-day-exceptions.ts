import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth, withPermission, type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { listDayExceptions } from '@/modules/attendance/workflow/dayExceptionQueries';
import {
  DAY_EXCEPTION_KINDS, DAY_EXCEPTION_STATUSES,
  type DayExceptionKind, type DayExceptionStatusFilter,
} from '@/modules/attendance/workflow/types';

const STATUSES = new Set<string>(['unresolved', 'all', ...DAY_EXCEPTION_STATUSES]);
const KINDS = new Set<string>(DAY_EXCEPTION_KINDS);

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    return;
  }
  const status = typeof req.query.status === 'string' ? req.query.status : 'unresolved';
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
  if (!STATUSES.has(status)) {
    apiResponse.badRequest(res, 'status is not a supported day-exception filter');
    return;
  }
  if (kind !== undefined && !KINDS.has(kind)) {
    apiResponse.badRequest(res, 'kind is not a supported day-exception kind');
    return;
  }
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) {
    apiResponse.badRequest(res, 'limit must be an integer between 1 and 200');
    return;
  }
  const user = (req as AuthenticatedNextApiRequest).user;
  try {
    const result = await listDayExceptions({
      user, status: status as DayExceptionStatusFilter,
      kind: kind as DayExceptionKind | undefined, limit: rawLimit,
    });
    apiResponse.success(res, result);
  } catch (error) {
    log.error('[staff-attendance-day-exceptions] list failed', {
      userId: user.id, status, kind,
      error: error instanceof Error ? error.message : String(error),
    });
    apiResponse.internalError(res, error);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.corrections', 'view')(handler)
);
