import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { safeArrayQuery } from '../../../../lib/safe-query';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const schedules = await safeArrayQuery(async () => [], { logError: false });
      return apiResponse.success(res, { schedules, total: 0, taskCounts: [] }, 'Schedules functionality is being migrated');
    } catch (error) {
      log.error('FieldSchedules', `Error fetching schedules: ${error}`);
      return apiResponse.internalError(res, error);
    }
  } else if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, `Schedule ${req.method === 'POST' ? 'creation' : req.method === 'PUT' ? 'updates' : 'deletion'} is temporarily disabled during migration`);
  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT', 'DELETE']);
  }
}

export default withAuth(handler);
