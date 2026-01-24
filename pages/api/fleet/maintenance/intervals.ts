/**
 * Fleet Maintenance API - Service Intervals
 * GET /api/fleet/maintenance/intervals - Get all intervals (optionally filtered by vehicleId)
 * POST /api/fleet/maintenance/intervals - Create a new service interval
 *
 * Query params (GET):
 * - vehicleId: optional UUID to filter by vehicle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getServiceIntervals,
  createServiceInterval,
} from '@/modules/fleet/services/maintenanceService';
import type { CreateServiceIntervalInput } from '@/modules/fleet/types/maintenance.types';
import { withAuth } from '@/lib/auth';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    try {
      const { vehicleId } = req.query;

      if (!vehicleId || typeof vehicleId !== 'string') {
        return apiResponse.validationError(res, { vehicleId: 'vehicleId is required' });
      }

      const intervals = await getServiceIntervals(vehicleId);
      return apiResponse.success(res, intervals);
    } catch (error) {
      log.error('Failed to get service intervals', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const input: CreateServiceIntervalInput = req.body;

      // Validate required fields
      if (!input.vehicleId) {
        return apiResponse.validationError(res, { vehicleId: 'vehicleId is required' });
      }
      if (!input.serviceType) {
        return apiResponse.validationError(res, { serviceType: 'serviceType is required' });
      }

      const interval = await createServiceInterval(input);
      res.status(201);
      return apiResponse.success(res, interval);
    } catch (error) {
      log.error('Failed to create service interval', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));
