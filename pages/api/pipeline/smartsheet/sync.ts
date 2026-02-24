/**
 * API: Trigger Smartsheet sync
 * POST /api/pipeline/smartsheet/sync
 *
 * Protected: super_admin role required
 *
 * Fire-and-forget: returns 202 immediately,
 * sync runs in background. Client polls /api/pipeline/smartsheet/history
 * for completion status.
 *
 * The promise is stored at module level so Node.js keeps the
 * async work alive after the HTTP response is sent.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';
import { log } from '@/lib/logger';
import { withAuth, withRole, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

// Velocity_Master_Tracker sheet ID
const DEFAULT_SHEET_ID = '8735086443712388';

// Module-level reference prevents Node.js from GC'ing the background promise
// after the HTTP response is sent. Without this, Next.js API routes clean up
// detached promises and the sync never executes.
let _activeSyncPromise: Promise<void> | null = null;

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  // Reject if a sync is already running
  if (_activeSyncPromise) {
    return res.status(409).json({
      success: false,
      error: 'A sync is already running. Wait for it to complete.',
    });
  }

  try {
    const { sheetId } = req.body;
    const userId = req.user?.id;

    const targetSheetId = sheetId || DEFAULT_SHEET_ID;

    log.info('Smartsheet sync triggered, starting background work', {
      sheetId: targetSheetId,
      userId,
    });

    // Store at module level so Node keeps it alive after res.end()
    _activeSyncPromise = pipelineSmartsheetService.syncFromSmartsheet(
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
    }).finally(() => {
      _activeSyncPromise = null;
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
