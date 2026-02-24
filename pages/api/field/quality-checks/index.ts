import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { safeArrayQuery } from '../../../../lib/safe-query';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const qualityChecks = await safeArrayQuery(async () => [], { logError: false });
      return apiResponse.success(res, {
        qualityChecks,
        total: 0,
        stats: { totalChecks: 0, passed: 0, failed: 0, averageScore: 0, byType: {} },
      }, 'Quality checks functionality is being migrated');
    } catch (error) {
      log.error('FieldQualityChecks', `Error fetching quality checks: ${error}`);
      return apiResponse.internalError(res, error);
    }
  } else if (req.method === 'POST' || req.method === 'PUT') {
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, `Quality check ${req.method === 'POST' ? 'creation' : 'updates'} temporarily disabled during migration`);
  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST', 'PUT']);
  }
}

export default withAuth(handler);
