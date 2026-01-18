/**
 * API: Vehicle Check-In Records
 * GET /api/fleet/vehicles/[vehicleId]/check-records - List check-in records for a vehicle
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { getCheckRecords } from '@/modules/fleet/services/checkInService';
import type { CheckRecordStatus } from '@/modules/fleet/types/check-in.types';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { vehicleId, limit, offset, status } = req.query;

  if (!vehicleId || typeof vehicleId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
  }

  try {
    switch (req.method) {
      case 'GET': {
        // Use getCheckRecords with vehicleId filter to get full details
        const result = await getCheckRecords({
          vehicleId,
          limit: limit ? parseInt(limit as string, 10) : 50,
          offset: offset ? parseInt(offset as string, 10) : 0,
          status: status as CheckRecordStatus | undefined,
        });

        return apiResponse.success(res, result);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
