import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { getZoneDeliveryTracker } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryTracker';
import {
  parseTrackerQuery,
  READ_PERMISSION,
  zoneDeliveryResponse,
} from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryHttp';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  return zoneDeliveryResponse(res, () =>
    getZoneDeliveryTracker(pool, parseTrackerQuery(req)));
}

export default withAuth(withPermission(READ_PERMISSION, 'view')(handler));
