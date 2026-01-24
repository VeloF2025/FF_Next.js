/**
 * Fleet Maintenance API - Service History
 * GET /api/fleet/maintenance/history - Get service history
 * POST /api/fleet/maintenance/history - Record a completed service
 *
 * Query params (GET):
 * - vehicleId: optional UUID to filter by vehicle
 * - limit: optional number (default: 50)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  getServiceHistory,
  recordService,
} from '@/modules/fleet/services/maintenanceService';
import type { RecordServiceInput } from '@/modules/fleet/types/maintenance.types';
import { withAuth } from '@/lib/auth';

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method === 'GET') {
    try {
      const { vehicleId, limit = '50' } = req.query;

      const limitNum = parseInt(limit as string, 10);
      if (isNaN(limitNum) || limitNum < 1 || limitNum > 200) {
        return apiResponse.validationError(res, { limit: 'Invalid limit. Use a number between 1 and 200' });
      }

      const history = await getServiceHistory(
        vehicleId as string | undefined,
        limitNum
      );
      return apiResponse.success(res, history);
    } catch (error) {
      log.error('Failed to get service history', { error });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'POST') {
    try {
      const input: RecordServiceInput = req.body;

      // Validate required fields
      if (!input.vehicleId) {
        return apiResponse.validationError(res, { vehicleId: 'vehicleId is required' });
      }
      if (!input.serviceType) {
        return apiResponse.validationError(res, { serviceType: 'serviceType is required' });
      }
      if (!input.serviceDate) {
        return apiResponse.validationError(res, { serviceDate: 'serviceDate is required' });
      }

      const service = await recordService(input);
      res.status(201);
      return apiResponse.success(res, service);
    } catch (error) {
      log.error('Failed to record service', { error });
      return apiResponse.internalError(res, error);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}));
