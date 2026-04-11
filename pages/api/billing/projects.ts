/**
 * GET /api/billing/projects
 * Returns the list of projects with at least one active client_purchase_orders
 * row — i.e. projects that the weekly billing upload can actually invoice.
 * Used by BillingUploadTab as the fallback override dropdown when PDF-based
 * auto-detection fails or is ambiguous.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { fetchBillableProjects } from '@/modules/billing/services/resolveProjectName';

const logger = createLogger('api/billing/projects');

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const projects = await fetchBillableProjects();
    return apiResponse.success(res, { projects });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list billable projects';
    logger.error('projects GET failed', { error: message });
    return res.status(500).json({ success: false, error: message });
  }
}

export default withAuth(handler);
