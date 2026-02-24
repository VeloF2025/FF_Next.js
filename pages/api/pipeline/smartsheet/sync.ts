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
import * as fs from 'fs';

// Velocity_Master_Tracker sheet ID
const DEFAULT_SHEET_ID = '8735086443712388';

// Track whether a sync is in progress to prevent concurrent runs
let _syncRunning = false;

// Debug helper that writes to a file (can't be stripped by minifier)
function syncDebug(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync('/tmp/smartsheet-sync-debug.log', line); } catch { /* ignore */ }
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  syncDebug('Handler called, method=POST');

  if (_syncRunning) {
    syncDebug('Rejected: sync already running');
    return res.status(409).json({
      success: false,
      error: 'A sync is already running. Wait for it to complete.',
    });
  }

  const { sheetId } = req.body;
  const userId = req.user?.id;
  const targetSheetId = sheetId || DEFAULT_SHEET_ID;

  syncDebug(`Sending 202, sheetId=${targetSheetId}, userId=${userId}`);
  log.info('Smartsheet sync triggered', { sheetId: targetSheetId, userId });

  // Send 202 immediately
  res.status(202).json({
    success: true,
    data: {
      message: 'Sync started — processing in background. Poll history for status.',
      status: 'running',
    },
  });

  syncDebug('202 sent, scheduling background sync via setImmediate');

  // Use setImmediate to completely detach from HTTP request context
  setImmediate(() => {
    syncDebug('setImmediate fired, starting sync...');
    _syncRunning = true;

    pipelineSmartsheetService.syncFromSmartsheet(
      targetSheetId,
      'manual',
      userId
    ).then((result) => {
      syncDebug(`Sync completed: success=${result.success}, processed=${result.stats.processed}`);
      log.info('Smartsheet sync completed', {
        success: result.success,
        processed: result.stats.processed,
        created: result.stats.created,
        updated: result.stats.updated,
        errored: result.stats.errored,
        duration_ms: result.duration_ms,
      });
    }).catch((error) => {
      syncDebug(`Sync error: ${error instanceof Error ? error.message : String(error)}`);
      log.error('Smartsheet sync failed in background', error);
    }).finally(() => {
      _syncRunning = false;
      syncDebug('Sync promise settled, _syncRunning=false');
    });
  });
}

// Protect endpoint: requires super_admin role
export default withAuth(withRole('super_admin')(handler));
