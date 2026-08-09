import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  COMMAND_PERMISSIONS,
  parseHandoverBody,
  parseZoneQuery,
  READ_PERMISSION,
  zoneDeliveryErrorBoundary,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

const service = createZoneDeliveryService(pool);

const readHandler = withPermission(READ_PERMISSION, 'view')(
  async (req: NextApiRequest, res: NextApiResponse) =>
    zoneDeliveryResponse(res, () => service.getZone(parseZoneQuery(req))),
);

/**
 * Declaring a handover is a zone-level act, so it is gated on the same
 * permission as the other zone-level command rather than the per-PON confirms.
 */
const declareHandler = withPermission(COMMAND_PERMISSIONS.zoneQa, 'edit')(
  async (req: NextApiRequest, res: NextApiResponse) =>
    zoneDeliveryResponse(res, async () => {
      const input = parseHandoverBody(req.body);
      const user = (req as AuthenticatedNextApiRequest).user;
      return service.declareZoneHandover(input, {
        userId: user.id,
        email: user.email,
        permission: COMMAND_PERMISSIONS.zoneQa,
      });
    }),
);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return readHandler(req, res);
  if (req.method === 'POST') {
    return zoneDeliveryErrorBoundary(res, () => declareHandler(req, res));
  }
  return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(handler);
