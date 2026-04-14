/**
 * API: List Smartsheet sheets
 * GET /api/pipeline/smartsheet/sheets
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const sheets = await pipelineSmartsheetService.listSheets();

    return apiResponse.success(res, {
      sheets,
      count: sheets.length,
    });
  } catch (error) {
   log.error('smartsheet-sheets', { error: error instanceof Error ? error.message : String(error) });
    log.error('smartsheet-sheets', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
