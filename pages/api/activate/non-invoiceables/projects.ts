import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { getDistinctNonInvoiceableProjects } from '@/modules/activate/services/projectsService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('activate:non-invoiceables:projects');

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }
  try {
    const projects = await getDistinctNonInvoiceableProjects();
    return apiResponse.success(res, { projects });
  } catch (error) {
    logger.error('Failed to fetch non-invoiceables projects', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler as any);
