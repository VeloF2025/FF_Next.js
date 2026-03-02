/**
 * Cost Centres API
 * GET  — list all cost centres
 * POST — create a new cost centre
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getCostCentres, createCostCentre } from '@/modules/accounting/services/costCentreService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as AuthenticatedNextApiRequest).user.id;

  if (req.method === 'GET') {
    const activeOnly = req.query.active === 'true';
    const items = await getCostCentres(activeOnly);
    return apiResponse.success(res, { items });
  }

  if (req.method === 'POST') {
    const { code, name, description, department } = req.body;
    if (!code || !name) return apiResponse.badRequest(res, 'code and name are required');
    try {
      const cc = await createCostCentre({ code, name, description, department }, userId);
      return apiResponse.success(res, cc);
    } catch (err) {
      log.error('Failed to create cost centre', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, err instanceof Error ? err.message : 'Failed');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method!);
}

export default withAuth(withErrorHandler(handler));
