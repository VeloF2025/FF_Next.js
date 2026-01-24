/**
 * Fleet Maintenance API - Single Service Interval
 * GET /api/fleet/maintenance/intervals/[id] - Get a single interval
 * PUT /api/fleet/maintenance/intervals/[id] - Update an interval
 * DELETE /api/fleet/maintenance/intervals/[id] - Delete an interval
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getServiceInterval,
  updateServiceInterval,
  deleteServiceInterval,
} from '@/modules/fleet/services/maintenanceService';
import type { UpdateServiceIntervalInput } from '@/modules/fleet/types/maintenance.types';
import { withAuth } from '@/lib/auth';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.validationError(res, { id: 'Interval ID is required' });
  }

  if (req.method === 'GET') {
    try {
      const interval = await getServiceInterval(id);
      if (!interval) {
        return apiResponse.notFound(res, 'Service interval', id);
      }
      return apiResponse.success(res, interval);
    } catch (error) {
      log.error('Failed to get service interval', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'PUT') {
    try {
      const input: UpdateServiceIntervalInput = req.body;
      const interval = await updateServiceInterval(id, input);
      return apiResponse.success(res, interval);
    } catch (error) {
      log.error('Failed to update service interval', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'DELETE') {
    try {
      await deleteServiceInterval(id);
      return apiResponse.success(res, { deleted: true });
    } catch (error) {
      log.error('Failed to delete service interval', { error, id });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
}));
