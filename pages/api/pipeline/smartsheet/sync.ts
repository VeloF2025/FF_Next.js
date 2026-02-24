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

// Track whether a sync is in progress to prevent concurrent runs
let _syncRunning = false;

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  if (_syncRunning) {
    return res.status(409).json({
      success: false,
      error: 'A sync is already running. Wait for it to complete.',
    });
  }

  try {
    const { sheetId } = req.body;
    const userId = req.user?.id;
    const targetSheetId = sheetId || DEFAULT_SHEET_ID;

    log.info('Smartsheet sync triggered', { sheetId: targetSheetId, userId });

    // Send 202 immediately — res.json() flushes the response to the client.
    // The async handler continues executing below (the withAuth wrapper awaits
    // the full handler promise, keeping the async context alive in Node.js).
    res.status(202).json({
      success: true,
      data: {
        message: 'Sync started — processing in background. Poll history for status.',
        status: 'running',
      },
    });

    // Now run the sync in the SAME async context (no detached promise).
    // The HTTP response is already sent; this just keeps the handler running.
    _syncRunning = true;
    try {
      const result = await pipelineSmartsheetService.syncFromSmartsheet(
        targetSheetId,
        'manual',
        userId
      );
      log.info('Smartsheet sync completed', {
        success: result.success,
        processed: result.stats.processed,
        created: result.stats.created,
        updated: result.stats.updated,
        errored: result.stats.errored,
        duration_ms: result.duration_ms,
      });
    } catch (error) {
      log.error('Smartsheet sync failed in background', error);
    } finally {
      _syncRunning = false;
    }
  } catch (error) {
    // Only reaches here if something fails before res.json()
    if (!res.headersSent) {
      return apiResponse.internalError(res, error);
    }
    log.error('Smartsheet sync handler error', error);
  }
}

// Protect endpoint: requires super_admin role
export default withAuth(withRole('super_admin')(handler));
