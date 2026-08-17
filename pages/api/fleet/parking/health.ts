import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { loadParkingRunHealth } from '@/modules/fleet/parking/runQueries';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  try { return apiResponse.success(res, await loadParkingRunHealth(new Date())); }
  catch (error) { log.error('Failed to load parking run health', { error }, 'fleet'); return apiResponse.internalError(res, undefined, 'Could not load parking check health'); }
}

export default withAuth(withPermission('fleet.parking', 'view')(handler));
