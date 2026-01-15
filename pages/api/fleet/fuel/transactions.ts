/**
 * Fleet Fuel Transactions API
 * GET /api/fleet/fuel/transactions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getFuelTransactions } from '@/modules/fleet/services';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const {
      vehicleId,
      startDate,
      endDate,
      limit = '50',
      offset = '0',
    } = req.query;

    const result = await getFuelTransactions({
      vehicleId: vehicleId as string | undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    return apiResponse.success(res, result);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
