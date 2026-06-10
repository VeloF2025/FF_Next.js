/**
 * GET /api/my/stores/serials/[serialNumber] — look up a serial for the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of GET /api/procurement/field-stock/serials/[serialNumber].
 * Reuses serialService so there is one source of truth. Read-only — status writes go
 * through the domain endpoints (pickings, returns), never here.
 *
 * Gated to stores roles via requireStoresActor.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import {
  getSerialByNumber,
  getSerialById,
  getSerialHistory,
} from '@/modules/procurement/field-stock/services/serialService';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  const { serialNumber } = req.query;
  if (!serialNumber || typeof serialNumber !== 'string') {
    return apiResponse.validationError(res, { serialNumber: 'Serial number is required' });
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serialNumber);
    const serial = isUuid ? await getSerialById(serialNumber) : await getSerialByNumber(serialNumber);

    if (!serial) {
      return apiResponse.notFound(res, 'Serial', serialNumber);
    }

    if (req.query.includeHistory === 'true' && serial.id) {
      const history = await getSerialHistory(serial.id);
      return apiResponse.success(res, { ...serial, history });
    }

    return apiResponse.success(res, serial);
  } catch (error) {
    log.error('my-stores serial API error', { error }, 'my/stores/serials/[number]');
    return apiResponse.internalError(res, error);
  }
});
