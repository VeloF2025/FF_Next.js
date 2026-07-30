import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  COMMAND_PERMISSIONS,
  parseZoneQaBody,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

const service = createZoneDeliveryService(pool);
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return zoneDeliveryResponse(res, async () => {
    const user = (req as AuthenticatedNextApiRequest).user;
    const actor = { userId: user.id, email: user.email, permission: COMMAND_PERMISSIONS.zoneQa };
    return service.recordZoneQa(parseZoneQaBody(req.body), actor);
  });
}
export default withAuth(withPermission(COMMAND_PERMISSIONS.zoneQa, 'edit')(handler));
