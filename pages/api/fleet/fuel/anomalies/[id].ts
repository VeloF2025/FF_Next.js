/**
 * Fleet Fuel Anomaly Update API
 * PUT /api/fleet/fuel/anomalies/[id] - Update anomaly status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { updateAnomalyStatus } from '@/modules/fleet/services';
import type { AnomalyStatus } from '@/modules/fleet/types/fuel-analytics.types';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Anomaly ID is required');
  }

  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { status, investigatedBy, resolutionNotes } = req.body;

    if (!status) {
      return apiResponse.badRequest(res, 'Status is required');
    }

    const validStatuses: AnomalyStatus[] = ['detected', 'investigating', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return apiResponse.badRequest(res, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const anomaly = await updateAnomalyStatus(id, status, investigatedBy, resolutionNotes);

    return apiResponse.success(res, anomaly);
  } catch (error) {
    log.error('Operation failed', { error: { error } }, 'IdApi');
    if (error instanceof Error && error.message === 'Anomaly not found') {
      return apiResponse.notFound(res, 'Anomaly', id);
    }
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
