import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { userHasPermission } from '@/lib/permissions';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  COMMAND_PERMISSIONS,
  PREREQUISITE_OVERRIDE_PERMISSION,
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
      // Resolved against the database, not the token's permission array: the
      // operators who need this hold the grant through user_permission_overrides,
      // which the array never carries. Only looked up when actually requested.
      const canOverridePrerequisites = input.overridePrerequisite === true
        && await userHasPermission(user.id, PREREQUISITE_OVERRIDE_PERMISSION, 'edit');
      return service.declareZoneHandover(input, {
        userId: user.id,
        email: user.email,
        permission: COMMAND_PERMISSIONS.zoneQa,
        canOverridePrerequisites,
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
