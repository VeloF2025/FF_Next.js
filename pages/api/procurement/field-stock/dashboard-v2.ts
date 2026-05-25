/**
 * Field Stock Dashboard v2 API
 * GET /api/procurement/field-stock/dashboard-v2 — four new metric groups.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth';
import { getDashboardV2Summary } from '@/modules/procurement/field-stock/services/dashboardV2Service';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    const summary = await getDashboardV2Summary();
    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('Field stock dashboard v2 API error', { error }, 'field-stock/dashboard-v2');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('procurement.field-stock', 'view')(handler));
