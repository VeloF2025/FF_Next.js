/**
 * Fix 1Map Record Status API
 *
 * POST: Set a prop record's status to "Home Installation: Installed"
 *
 * Request body:
 * - propId: string (1Map prop_id)
 * - drNumber: string (for logging)
 *
 * Also updates olt_mismatch_records to mark the status mismatch as fixed.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import { logActivity } from '@/modules/activate/services/activityLogService';

const INSTALLED_STATUS = 'Home Installation: Installed';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { propId, drNumber } = req.body;

  if (!propId || !drNumber) {
    return apiResponse.badRequest(res, 'propId and drNumber are required');
  }

  const user = getAuthUser(req);
  const userId = user?.id || null;
  const client = await pool.connect();

  try {
    const result = await oneMapApi.updateRecordStatus(propId, INSTALLED_STATUS);

    if (result.success) {
      await logActivity(
        drNumber,
        'STATUS_UPDATE',
        {
          details: `1Map status set to "${INSTALLED_STATUS}" on prop_id ${propId}` +
            (result.oldStatus ? ` (was "${result.oldStatus}")` : ''),
          source: 'olt_report',
          fix_type: 'status_fix',
          propId,
          oldStatus: result.oldStatus || null,
          newStatus: INSTALLED_STATUS,
        },
        userId || 'system'
      );

      // Mark the mismatch record as fixed
      await client.query(
        `UPDATE olt_mismatch_records
         SET fix_status = 'fixed',
             fix_attempted_at = NOW(),
             fix_result = $1,
             fix_old_value = $2,
             fix_by = $3
         WHERE drop_number = $4
           AND fix_status = 'pending'
           AND investigation_context::text LIKE '%status_mismatch%'`,
        [
          'success',
          JSON.stringify({ oldStatus: result.oldStatus, propId }),
          userId,
          drNumber,
        ]
      );

      // Record in serial_change_history for audit trail
      await client.query(
        `INSERT INTO serial_change_history
         (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
         VALUES ($1, 'status', $2, $3, 'olt_report_fix', 'status_fix', $4, $5)`,
        [
          drNumber,
          result.oldStatus || null,
          INSTALLED_STATUS,
          userId || 'system',
          JSON.stringify({ propId, source: 'olt_report', fix_type: 'status_fix' }),
        ]
      );

      log.info('Status updated', { error: { drNumber, propId, oldStatus: result.oldStatus, newStatus: INSTALLED_STATUS } }, 'FixStatus');
    }

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('Status fix failed', { error: { error, drNumber, propId } }, 'FixStatus');
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
