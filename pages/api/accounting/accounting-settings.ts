/**
 * Accounting Settings API
 * GET  ?key=reporting_currency — get setting value
 * PUT  { key, value } — update setting
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { getSetting, setSetting } from '@/modules/accounting/services/currencyService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authReq = req as AuthenticatedNextApiRequest;
  if (req.method === 'GET') {
    const { key } = req.query;
    if (!key) return apiResponse.badRequest(res, 'key is required');
    const value = await getSetting(key as string);
    return apiResponse.success(res, { key, value });
  }

  if (req.method === 'PUT') {
    const userId = authReq.user.id;
    const { key, value } = req.body;
    if (!key || !value) return apiResponse.badRequest(res, 'key and value required');
    await setSetting(key, value, userId);
    return apiResponse.success(res, { updated: true });
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT']);
}

export default withAuth(withErrorHandler(handler));
