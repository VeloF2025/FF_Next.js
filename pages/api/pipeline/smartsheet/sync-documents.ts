/**
 * API: Sync documents from Smartsheet to FibreFlow storage
 * POST /api/pipeline/smartsheet/sync-documents
 *
 * Protected: super_admin role required
 */

import type { NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { apiResponse } from '@/lib/apiResponse';
import { syncDocumentsFromSmartsheet } from '@/modules/pipeline/services';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { limit, skipExisting = true } = req.body || {};

    const result = await syncDocumentsFromSmartsheet({
      limit: limit ? Number(limit) : undefined,
      skipExisting: skipExisting !== false,
    });

    return apiResponse.success(res, result);
  } catch (error) {
   log.error('smartsheet-sync-documents', { error: error instanceof Error ? error.message : String(error) });
    log.error('smartsheet-sync-docs', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

// Protect endpoint: requires super_admin role
export default withAuth(withRole('super_admin')(handler));
