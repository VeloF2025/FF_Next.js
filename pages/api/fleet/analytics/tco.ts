/**
 * Fleet Analytics API - TCO Report
 * GET /api/fleet/analytics/tco - Get Total Cost of Ownership report
 *
 * Query params:
 * - period: '12m' | 'lifetime' (default: '12m')
 * - vehicleId: optional UUID for single vehicle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getTCOReport } from '@/modules/fleet/services';
import { withAuth } from '@/lib/auth';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { period = '12m', vehicleId } = req.query;

    // Validate period
    if (period !== '12m' && period !== 'lifetime') {
      return apiResponse.validationError(res, { period: 'Invalid period. Use "12m" or "lifetime"' });
    }

    const tcoReport = await getTCOReport(
      period as '12m' | 'lifetime',
      vehicleId as string | undefined
    );

    return apiResponse.success(res, tcoReport);
  } catch (error) {
    log.error('Failed to get TCO report', { error });
    return apiResponse.internalError(res, error);
  }
}));
