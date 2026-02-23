/**
 * API: Trigger Smartsheet sync
 * POST /api/pipeline/smartsheet/sync
 *
 * Protected: super_admin role required
 *
 * Fire-and-forget: returns 202 immediately with historyId,
 * sync runs in background. Client polls /api/pipeline/smartsheet/history
 * for completion status.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';
import { log } from '@/lib/logger';
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

    // Fire-and-forget: start sync in background, respond immediately
    // This avoids Cloudflare 524 timeouts (sync takes 5-6 min for ~210 rows)
    pipelineSmartsheetService.syncFromSmartsheet(
      targetSheetId,
      'manual',
      userId
    ).then((result) => {
      log.info('Smartsheet sync completed in background', {
        success: result.success,
        processed: result.stats.processed,
        created: result.stats.created,
        updated: result.stats.updated,
        errored: result.stats.errored,
        duration_ms: result.duration_ms,
      });
    }).catch((error) => {
      log.error('Smartsheet sync failed in background', error);
    });

    return res.status(202).json({
      success: true,
      data: {
        message: 'Sync started — processing in background. Poll history for status.',
        status: 'running',
      },
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

// Protect endpoint: requires super_admin role
export default withAuth(withRole('super_admin')(handler));
