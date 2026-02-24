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
    // eslint-disable-next-line no-console -- temporary debug to trace background execution
    console.log('[SYNC DEBUG] Handler entered, sending 202...');

    // Send 202 immediately — res.json() flushes the response to the client.
    res.status(202).json({
      success: true,
      data: {
        message: 'Sync started — processing in background. Poll history for status.',
        status: 'running',
      },
    });

    // eslint-disable-next-line no-console -- temporary debug
    console.log('[SYNC DEBUG] 202 sent, starting background sync...');

    // Run sync in same async context after response is flushed
    _syncRunning = true;
    try {
      // eslint-disable-next-line no-console -- temporary debug
      console.log('[SYNC DEBUG] Calling syncFromSmartsheet...');
      const result = await pipelineSmartsheetService.syncFromSmartsheet(
        targetSheetId,
        'manual',
        userId
      );
      // eslint-disable-next-line no-console -- temporary debug
      console.log('[SYNC DEBUG] Sync completed:', result.success, result.stats.processed, 'rows');
      log.info('Smartsheet sync completed', {
        success: result.success,
        processed: result.stats.processed,
        created: result.stats.created,
        updated: result.stats.updated,
        errored: result.stats.errored,
        duration_ms: result.duration_ms,
      });
    } catch (error) {
      // eslint-disable-next-line no-console -- temporary debug
      console.log('[SYNC DEBUG] Sync error:', error instanceof Error ? error.message : error);
      log.error('Smartsheet sync failed in background', error);
    } finally {
      _syncRunning = false;
      // eslint-disable-next-line no-console -- temporary debug
      console.log('[SYNC DEBUG] Handler complete, _syncRunning reset');
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
