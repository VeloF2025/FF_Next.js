/**
 * Field Stock Serial by Number API
 * GET /api/procurement/field-stock/serials/[serialNumber] - Get serial by number
 *
 * Status writes go through the serial lifecycle (promoteSerial) from the
 * specific domain endpoints (pickings, returns, fault-reports); the generic
 * PUT status-setter was retired at the Sprint E cutover (Track 7).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import {
  getSerialByNumber,
  getSerialById,
  getSerialHistory,
} from '@/modules/procurement/field-stock/services/serialService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { serialNumber } = req.query;

  if (!serialNumber || typeof serialNumber !== 'string') {
    return apiResponse.validationError(res, { serialNumber: 'Serial number is required' });
  }

  try {
    if (req.method === 'GET') {
      // Check if requesting by ID or number
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serialNumber);

      let serial;
      if (isUuid) {
        serial = await getSerialById(serialNumber);
      } else {
        serial = await getSerialByNumber(serialNumber);
      }

      if (!serial) {
        return apiResponse.notFound(res, 'Serial', serialNumber);
      }

      // Include history if requested
      if (req.query.includeHistory === 'true' && serial.id) {
        const history = await getSerialHistory(serial.id);
        return apiResponse.success(res, { ...serial, history });
      }

      return apiResponse.success(res, serial);
    }

    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  } catch (error) {
    log.error('Field stock serial API error', { error: error }, 'field-stock/serials/[number]');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
