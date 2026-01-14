/**
 * API: Fleet Check-In by Vehicle
 * GET /api/fleet/check-in/vehicle/[vehicleId] - Get check-ins for a vehicle
 * GET /api/fleet/check-in/vehicle/[vehicleId]?availability=true - Check vehicle availability
 * GET /api/fleet/check-in/vehicle/[vehicleId]?stats=true - Get check-in stats
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  getCheckRecordsForVehicle,
  checkVehicleAvailability,
  getVehicleCheckInStats,
} from '@/modules/fleet/services/checkInService';
import type { CheckRecordStatus } from '@/modules/fleet/types/check-in.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { vehicleId, availability, stats, limit, offset, status } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Check vehicle availability
    if (availability === 'true') {
      const result = await checkVehicleAvailability(vehicleId);
      return apiResponse.success(res, result);
    }

    // Get vehicle stats
    if (stats === 'true') {
      const vehicleStats = await getVehicleCheckInStats(vehicleId);
      return apiResponse.success(res, vehicleStats);
    }

    // Get check-in records for vehicle
    const records = await getCheckRecordsForVehicle(vehicleId, {
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
      status: status as CheckRecordStatus | undefined,
    });

    return apiResponse.success(res, records);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
