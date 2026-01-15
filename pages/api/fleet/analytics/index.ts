/**
 * Fleet Analytics API - KPIs
 * GET /api/fleet/analytics - Get fleet-wide KPI summary
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getFleetKPIs } from '@/modules/fleet/services';

export default withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const kpis = await getFleetKPIs();
    return apiResponse.success(res, kpis);
  } catch (error) {
    log.error('Failed to get fleet KPIs', { error });
    return apiResponse.internalError(res, error);
  }
});
