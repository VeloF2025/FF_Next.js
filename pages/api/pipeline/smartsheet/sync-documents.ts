/**
 * API: Sync documents from Smartsheet to FibreFlow storage
 * POST /api/pipeline/smartsheet/sync-documents
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { syncDocumentsFromSmartsheet } from '@/modules/pipeline/services';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    const { limit, skipExisting = true } = req.body || {};

    const result = await syncDocumentsFromSmartsheet({
      limit: limit ? Number(limit) : undefined,
      skipExisting: skipExisting !== false,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
