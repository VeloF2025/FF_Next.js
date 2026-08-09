import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import { submitPonByNumber } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryPonSubmit';
import {
  COMMAND_PERMISSIONS,
  parsePonSubmitBody,
  zoneDeliveryErrorBoundary,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

const service = createZoneDeliveryService(pool);

/**
 * Submitting a PON is an operations attestation, so it is gated on the same
 * permission as the port_submitted milestone it records.
 */
const submitHandler = withPermission(COMMAND_PERMISSIONS.operations, 'edit')(
  async (req: NextApiRequest, res: NextApiResponse) =>
    zoneDeliveryResponse(res, () => {
      const input = parsePonSubmitBody(req.body);
      const user = (req as AuthenticatedNextApiRequest).user;
      return submitPonByNumber(pool, service, input, {
        userId: user.id,
        email: user.email,
        permission: COMMAND_PERMISSIONS.operations,
      });
    }),
);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }
  return zoneDeliveryErrorBoundary(res, () => submitHandler(req, res));
}

export default withAuth(handler);
