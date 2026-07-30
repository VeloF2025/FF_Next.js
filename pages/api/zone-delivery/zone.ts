import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { createZoneDeliveryService } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryService';
import {
  parseZoneQuery,
  READ_PERMISSION,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

const service = createZoneDeliveryService(pool);
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return zoneDeliveryResponse(res, () => service.getZone(parseZoneQuery(req)));
}
export default withAuth(withPermission(READ_PERMISSION, 'view')(handler));
