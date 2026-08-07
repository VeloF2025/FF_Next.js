/** GET /api/fleet/parking/requests — the pending approval queue. */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { loadPendingRequests } from '@/modules/fleet/parking/approvalQueries';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    return apiResponse.success(res, { requests: await loadPendingRequests() });
  } catch (err) {
    log.error('[fleet/parking] failed to load the approval queue', { error: err }, 'fleet');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('fleet.parking-requests', 'view')(handler));
