import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { getDistinctProjects } from '@/modules/activate/services/projectsService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('activate:projects');

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    const projects = await getDistinctProjects();
    return apiResponse.success(res, { projects });
  } catch (error) {
    logger.error('Failed to fetch projects', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler as any);
