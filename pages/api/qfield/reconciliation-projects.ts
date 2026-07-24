import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getProjects } from '@/modules/qfield-recon/services/qfcDeltaRepo';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  try {
    return apiResponse.success(res, { projects: await getProjects() });
  } catch (error) {
    log.error('qfield-recon-projects', error instanceof Error ? { message: error.message } : { error });
    return apiResponse.databaseError(res, error);
  }
}
export default withAuth(handler);
