/**
 * Fleet Analytics API - Driver Compliance
 * GET /api/fleet/analytics/compliance - Get driver check-in compliance rates
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getDriverCompliance } from '@/modules/fleet/services';

export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const compliance = await getDriverCompliance();
    return apiResponse.success(res, compliance);
  } catch (error) {
    log.error('Failed to get driver compliance', { error });
    return apiResponse.internalError(res, error);
  }
});
