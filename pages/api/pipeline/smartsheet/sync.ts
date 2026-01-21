/**
 * API: Trigger Smartsheet sync
 * POST /api/pipeline/smartsheet/sync
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';

// Velocity_Master_Tracker sheet ID
const DEFAULT_SHEET_ID = '8735086443712388';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, ['POST']);
  }

  try {
    const { sheetId, userId } = req.body;

    const targetSheetId = sheetId || DEFAULT_SHEET_ID;

    const result = await pipelineSmartsheetService.syncFromSmartsheet(
      targetSheetId,
      'manual',
      userId
    );

    return apiResponse.success(res, {
      message: result.success ? 'Sync completed successfully' : 'Sync completed with errors',
      ...result,
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}
