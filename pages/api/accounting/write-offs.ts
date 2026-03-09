/**
 * Customer Write-Offs API
 * GET  — list write-offs
 * POST — create write-off
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getWriteOffs, createWriteOff } from '@/modules/accounting/services/writeOffService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const { status, clientId, limit, offset } = req.query;
    const result = await getWriteOffs({
      status: status as string,
      clientId: clientId as string,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return apiResponse.success(res, result);
  }

  if (req.method === 'POST') {
    const userId = (req as unknown as { user?: { id: string } }).user?.id;
    if (!userId) return apiResponse.unauthorized(res, 'Unauthorized');
    try {
      const item = await createWriteOff(req.body, userId);
      return apiResponse.success(res, item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Create failed';
      log.error('Write-off create failed', { error: err }, 'accounting-api');
      return apiResponse.badRequest(res, msg);
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

export default withAuth(withErrorHandler(handler));
