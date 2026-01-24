/**
 * Fix 1Map ONT Serial API
 *
 * POST: Fix a DR's ONT serial in 1Map using the OLT report data
 *
 * Uses the OneMap API service with 4-step authentication to:
 * 1. Search for the DR in 1Map
 * 2. Update ph_ont with the correct OLT serial
 * 3. Log the old value for rollback capability
 * 4. Update the DR timeline
 *
 * Request body:
 * - drNumber: string (required)
 * - correctSerial: string (required) - The OLT serial to set
 * - wrongSerial: string (optional) - Helps identify correct record if multiple
 * - bulk: boolean (optional) - If true, process multiple DRs
 * - items: Array<{drNumber, correctSerial, wrongSerial}> (for bulk)
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import { logActivity } from '@/modules/activate/services/activityLogService';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface FixItem {
  drNumber: string;
  correctSerial: string;
  wrongSerial?: string;
}

interface FixResult {
  drNumber: string;
  success: boolean;
  propId: string | null;
  oldValue: string | null;
  newValue: string;
  error?: string;
}

async function fixSingleDR(
  client: ReturnType<Pool['connect']> extends Promise<infer T> ? T : never,
  item: FixItem,
  userId: string | null
): Promise<FixResult> {
  const { drNumber, correctSerial, wrongSerial } = item;

  // Skip if serial is empty
  if (!correctSerial || !correctSerial.trim()) {
    // Log to activity log
    await logActivity(
      drNumber,
      'error',
      { message: 'Skipped 1Map fix - empty OLT serial', source: 'olt_report' },
      userId || 'system'
    );

    return {
      drNumber,
      success: false,
      propId: null,
      oldValue: null,
      newValue: '',
      error: 'Empty serial - skipped',
    };
  }

  try {
    // Call OneMap API to fix the serial
    const result = await oneMapApi.fixDrOntSerial(drNumber, correctSerial, wrongSerial);

    if (result.success) {
      // Update offline_devices tracking
      await client.query(
        `UPDATE offline_devices
         SET onemap_fix_attempted = true,
             onemap_fix_result = 'success',
             onemap_fix_old_value = $1,
             onemap_fix_at = NOW(),
             onemap_fix_by = $2,
             mismatch_status = 'resolved',
             mismatch_resolution = 'data_corrected',
             mismatch_resolved_at = NOW(),
             mismatch_resolved_by = $3
         WHERE drop_number = $4`,
        [result.oldValue, userId, userId, drNumber]
      );

      // Log to activity log
      await logActivity(
        drNumber,
        'SERIAL_UPDATE',
        {
          details: `1Map ONT serial updated: ${result.oldValue || 'EMPTY'} → ${correctSerial}`,
          propId: result.propId,
          oldValue: result.oldValue,
          newValue: correctSerial,
          source: 'olt_report',
          fix_type: 'onemap_fix_success',
        },
        userId || 'system'
      );

      log.info('FixOneMap', 'Successfully fixed DR', {
        drNumber,
        propId: result.propId,
        oldValue: result.oldValue,
        newValue: correctSerial,
      });

      return {
        drNumber,
        success: true,
        propId: result.propId,
        oldValue: result.oldValue,
        newValue: correctSerial,
      };
    } else {
      // Record failure
      await client.query(
        `UPDATE offline_devices
         SET onemap_fix_attempted = true,
             onemap_fix_result = 'failed',
             onemap_fix_at = NOW()
         WHERE drop_number = $1`,
        [drNumber]
      );

      // Log to activity log
      await logActivity(
        drNumber,
        'error',
        {
          message: `1Map fix failed: ${result.error}`,
          source: 'olt_report',
          fix_type: 'onemap_fix_failed',
        },
        userId || 'system'
      );

      return {
        drNumber,
        success: false,
        propId: result.propId || null,
        oldValue: result.oldValue,
        newValue: correctSerial,
        error: result.error,
      };
    }
  } catch (error) {
    log.error('FixOneMap', 'Error fixing DR', { drNumber, error });
    return {
      drNumber,
      success: false,
      propId: null,
      oldValue: null,
      newValue: correctSerial,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const client = await pool.connect();
  const user = getAuthUser(req);

  try {
    const { drNumber, correctSerial, wrongSerial, bulk, items } = req.body;

    // Bulk mode
    if (bulk && Array.isArray(items)) {
      const results: FixResult[] = [];

      for (const item of items as FixItem[]) {
        const result = await fixSingleDR(client, item, user?.id || null);
        results.push(result);

        // Small delay between requests to avoid rate limiting
        await new Promise((r) => setTimeout(r, 300));
      }

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      log.info('FixOneMap', 'Bulk fix completed', { successCount, failCount });

      return apiResponse.success(res, {
        bulk: true,
        total: results.length,
        successCount,
        failCount,
        results,
      });
    }

    // Single DR mode
    if (!drNumber || !correctSerial) {
      return apiResponse.badRequest(res, 'drNumber and correctSerial are required');
    }

    const result = await fixSingleDR(
      client,
      { drNumber, correctSerial, wrongSerial },
      user?.id || null
    );

    if (result.success) {
      return apiResponse.success(res, result);
    } else {
      return apiResponse.success(res, result, 200); // Still 200 but success: false
    }
  } catch (error) {
    log.error('FixOneMap', 'API error', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
