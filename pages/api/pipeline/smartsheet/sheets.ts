/**
 * API: List Smartsheet sheets
 * GET /api/pipeline/smartsheet/sheets
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, ['GET']);
  }

  try {
    const sheets = await pipelineSmartsheetService.listSheets();

    return apiResponse.success(res, {
      sheets,
      count: sheets.length,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
