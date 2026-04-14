/**
 * Verify Consumption API
 * POST /api/procurement/field-stock/consumptions/[consumptionId]/verify
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { verifyConsumption } from '@/modules/procurement/field-stock/services/consumptionService';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { consumptionId } = req.query;

  if (!consumptionId || typeof consumptionId !== 'string') {
    return apiResponse.validationError(res, { consumptionId: 'Consumption ID is required' });
  }

  try {
    if (req.method === 'POST') {
      const { verifiedBy } = req.body;

      if (!verifiedBy) {
        return apiResponse.validationError(res, { verifiedBy: 'verifiedBy is required' });
      }

      const consumption = await verifyConsumption(consumptionId, verifiedBy);
      return apiResponse.success(res, consumption);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  } catch (error) {
    log.error('Verify consumption API error', { error: error }, 'field-stock/consumptions/verify');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
