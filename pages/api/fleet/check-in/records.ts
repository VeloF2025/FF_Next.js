/**
 * API: Fleet Check-In Records
 * GET /api/fleet/check-in/records - List check-in records
 * POST /api/fleet/check-in/records - Create a check-in record
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getCheckRecords,
  createCheckRecord,
  getFleetCheckInStats,
} from '@/modules/fleet/services/checkInService';
import type { CreateCheckRecordInput, CheckRecordStatus } from '@/modules/fleet/types/check-in.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const {
          limit,
          offset,
          status,
          driverId,
          dateFrom,
          dateTo,
          stats,
        } = req.query;

        // Return stats if requested
        if (stats === 'true') {
          const fleetStats = await getFleetCheckInStats();
          return apiResponse.success(res, fleetStats);
        }

        const result = await getCheckRecords({
          limit: limit ? parseInt(limit as string, 10) : undefined,
          offset: offset ? parseInt(offset as string, 10) : undefined,
          status: status as CheckRecordStatus | undefined,
          driverId: driverId as string | undefined,
          dateFrom: dateFrom as string | undefined,
          dateTo: dateTo as string | undefined,
        });

        return apiResponse.success(res, result);
      }

      case 'POST': {
        const input = req.body as CreateCheckRecordInput;

        if (!input.vehicleId) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
        }
        if (!input.driverId) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Driver ID is required');
        }
        if (!input.driverName) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Driver name is required');
        }
        // Responses are required for weekly checks, optional for daily
        if (input.checkType === 'weekly' && (!input.responses || !Array.isArray(input.responses))) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Responses array is required for weekly checks');
        }
        // Ensure responses is at least an empty array
        if (!input.responses) {
          input.responses = [];
        }

        const record = await createCheckRecord(input);
        return apiResponse.created(res, record);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
