import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { listOperationalProjectOptions } from '@/modules/fleet/operations/projectScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    const staffId = await resolveStaffIdForUser(user.id);
    return apiResponse.success(res, await listOperationalProjectOptions(user.id, staffId, user.role));
  } catch (error) {
    log.error('Failed to load fleet operational project options', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('fleet.operations-status', 'view')(handler));
