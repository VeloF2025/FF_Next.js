/**
 * API: Trigger Smartsheet sync
 * POST /api/pipeline/smartsheet/sync
 *
 * Protected: super_admin role required
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

// Velocity_Master_Tracker sheet ID
const DEFAULT_SHEET_ID = '8735086443712388';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { sheetId } = req.body;
    const userId = req.user?.id;

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

// Protect endpoint: requires super_admin role
export default withAuth(withRole('super_admin')(handler));
