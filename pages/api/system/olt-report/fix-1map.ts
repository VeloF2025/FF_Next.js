/**
 * Fix 1Map ONT Serial API
 *
 * POST: Fix a DR's ONT serial in 1Map using the OLT report data
 *
 * Uses the OneMap API service with 4-step authentication to:
 * 1. Search for the DR in 1Map
 * 2. Update ph_ont with the correct OLT serial
 * 3. If wrongSerial starts with "GU18", also update ph_ups (UPS serial swap detected)
 * 4. Log old values for rollback capability
 * 5. Update the DR timeline
 *
 * Request body:
 * - drNumber: string (required)
 * - correctSerial: string (required) - The OLT serial to set for ph_ont
 * - wrongSerial: string (optional) - Helps identify correct record; if starts with "GU18", also sets ph_ups
 * - bulk: boolean (optional) - If true, process multiple DRs
 * - items: Array<{drNumber, correctSerial, wrongSerial}> (for bulk)
 *
 * UPS Serial Detection:
 * When wrongSerial starts with "GU18", it indicates the technician swapped ONT and UPS serials.
 * In this case, both ph_ont (with correctSerial) and ph_ups (with wrongSerial) are updated.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool, PoolClient } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import { logActivity } from '@/modules/activate/services/activityLogService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Extend timeout for 1Map API calls (4-step auth is slow)
export const config = {
  maxDuration: 60, // 60 seconds max for Vercel
};

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
  alreadyCorrect?: boolean;
  // UPS serial info (when wrongSerial starts with GU18)
  upsSerial?: {
    oldValue: string | null;
    newValue: string | null;
    updated: boolean;
  };
}

// Helper to detect UPS serial pattern (starts with GU18)
function isUpsSerial(serial: string | undefined | null): boolean {
  return !!serial && serial.toUpperCase().startsWith('GU18');
}

async function fixSingleDR(
  client: PoolClient,
  item: FixItem,
  userId: string | null
): Promise<FixResult> {
  const { drNumber, correctSerial, wrongSerial } = item;

  // Skip if serial is empty
  if (!correctSerial || !correctSerial.trim()) {
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
    // Detect if wrongSerial is a UPS serial (starts with GU18)
    // This indicates the technician swapped ONT and UPS serials
    const hasUpsSerial = isUpsSerial(wrongSerial);
    const upsSerialToSet = hasUpsSerial ? wrongSerial : null;

    // Use dual update if UPS serial detected, otherwise single update
    if (hasUpsSerial) {
      log.info('FixOneMap', 'UPS serial detected - will update both ph_ont and ph_ups', {
        drNumber,
        ontSerial: correctSerial,
        upsSerial: wrongSerial,
      });
    }

    const result = hasUpsSerial
      ? await oneMapApi.fixDrOntAndUpsSerial(drNumber, correctSerial, upsSerialToSet, wrongSerial)
      : await oneMapApi.fixDrOntSerial(drNumber, correctSerial, wrongSerial);

    if (result.success) {
      const alreadyCorrect = result.error === 'Already correct';
      const fixResult = alreadyCorrect ? 'already_correct' : 'success';
      const resolution = alreadyCorrect ? 'already_correct' : 'data_corrected';

      // Extract multi-prop_id tracking info
      const totalRecords = result.totalRecords || 1;
      const updatedCount = result.updatedCount || (alreadyCorrect ? 0 : 1);
      const alreadyCorrectCount = result.alreadyCorrectCount || (alreadyCorrect ? 1 : 0);
      const allPropUpdates = result.allPropUpdates || [];

      // Build fix details for DB storage
      const fixDetails: Record<string, unknown> = {
        ont_old: 'ont' in result ? result.ont.oldValue : result.oldValue,
        ont_new: correctSerial,
        totalRecords,
        updatedCount,
        alreadyCorrectCount,
        allPropUpdates,
      };
      if (hasUpsSerial && 'ups' in result) {
        fixDetails.ups_old = result.ups.oldValue;
        fixDetails.ups_new = result.ups.newValue;
        fixDetails.ups_updated = result.ups.updated;
      }

      // Update offline_devices tracking (if exists)
      await client.query(
        `UPDATE offline_devices
         SET onemap_fix_attempted = true,
             onemap_fix_result = $1,
             onemap_fix_old_value = $2,
             onemap_fix_at = NOW(),
             onemap_fix_by = $3,
             mismatch_status = 'resolved',
             mismatch_resolution = $4,
             mismatch_resolved_at = NOW(),
             mismatch_resolved_by = $5
         WHERE drop_number = $6`,
        [fixResult, JSON.stringify(fixDetails), userId, resolution, userId, drNumber]
      );

      // Update olt_mismatch_records (always)
      await client.query(
        `UPDATE olt_mismatch_records
         SET fix_status = 'fixed',
             fix_attempted_at = NOW(),
             fix_result = $1,
             fix_old_value = $2,
             fix_by = $3
         WHERE drop_number = $4
           AND fix_status = 'pending'`,
        [fixResult, JSON.stringify(fixDetails), userId, drNumber]
      );

      // Update DR Review summary page serial (dr_photo_unified_reviews)
      await client.query(
        `UPDATE dr_photo_unified_reviews
         SET ont_serial_scanned = $1
         WHERE drop_number = $2`,
        [correctSerial, drNumber]
      );

      // Log to activity log with appropriate message
      const ontOldValue = 'ont' in result ? result.ont.oldValue : result.oldValue;

      // Build prop_id summary for activity log
      const propIdSummary = allPropUpdates.length > 0
        ? allPropUpdates.map((u: { propId: string; updated?: boolean; ont?: { updated: boolean } }) => {
            const wasUpdated = 'ont' in u ? u.ont?.updated : u.updated;
            return `${u.propId}:${wasUpdated ? 'FIXED' : 'OK'}`;
          }).join(', ')
        : `${result.propId || 'unknown'}`;

      if (alreadyCorrect) {
        await logActivity(
          drNumber,
          'SERIAL_VERIFIED',
          {
            details: `1Map CONFIRMED: All ${totalRecords} record(s) already have correct ONT serial ${correctSerial} [prop_ids: ${propIdSummary}]`,
            propId: 'propId' in result ? result.propId : null,
            ont: correctSerial,
            ups: upsSerialToSet,
            source: 'olt_report',
            fix_type: 'already_correct',
            totalRecords,
            allPropUpdates,
          },
          userId || 'system'
        );

        log.info('FixOneMap', 'DR already correct on all records', {
          drNumber,
          totalRecords,
          propIds: propIdSummary,
        });
      } else {
        let details = `1Map UPDATED: ONT serial fixed on ${updatedCount}/${totalRecords} record(s). `;
        details += `${ontOldValue || 'EMPTY'} → ${correctSerial}`;
        if (alreadyCorrectCount > 0) {
          details += ` (${alreadyCorrectCount} already correct)`;
        }
        details += ` [prop_ids: ${propIdSummary}]`;

        if (hasUpsSerial && 'ups' in result && result.ups.updated) {
          details += ` | UPS serial: ${result.ups.oldValue || 'EMPTY'} → ${result.ups.newValue}`;
        }

        await logActivity(
          drNumber,
          'SERIAL_UPDATE',
          {
            details,
            propId: 'propId' in result ? result.propId : null,
            ont: { oldValue: ontOldValue, newValue: correctSerial },
            ups: hasUpsSerial && 'ups' in result
              ? { oldValue: result.ups.oldValue, newValue: result.ups.newValue, updated: result.ups.updated }
              : null,
            source: 'olt_report',
            fix_type: hasUpsSerial ? 'onemap_fix_ont_and_ups' : 'onemap_fix_success',
            totalRecords,
            updatedCount,
            allPropUpdates,
          },
          userId || 'system'
        );

        log.info('FixOneMap', `Fixed ${updatedCount}/${totalRecords} records for DR`, {
          drNumber,
          updatedCount,
          alreadyCorrectCount,
          propIds: propIdSummary,
        });
      }

      // Look up displaced ONT activation status before recording history
      let displacedInfo: { activated: boolean; ownerDr: string | null; ownerTeam: string | null } | null = null;
      if (wrongSerial && !alreadyCorrect) {
        try {
          const displacedLookup = await client.query(
            `SELECT drop_number, team, status FROM oes_activations
             WHERE UPPER(serial_number) = $1 ORDER BY created_at DESC LIMIT 1`,
            [wrongSerial.toUpperCase()]
          );
          const row = displacedLookup.rows[0];
          displacedInfo = {
            activated: !!row,
            ownerDr: row?.drop_number || null,
            ownerTeam: row?.team || null,
          };
        } catch {
          // Non-fatal — continue without displaced info
        }
      }

      // Record in serial_change_history for DR Review Serial History tab
      const propId = 'propId' in result ? result.propId : null;
      await client.query(
        `INSERT INTO serial_change_history
         (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
         VALUES ($1, 'ont_serial', $2, $3, 'olt_report_fix', $4, $5, $6)`,
        [
          drNumber,
          ontOldValue || null,
          correctSerial,
          alreadyCorrect ? 'verification' : 'data_fix',
          userId || 'system',
          JSON.stringify({
            propId,
            source: 'olt_report',
            fix_type: alreadyCorrect ? 'already_correct' : 'onemap_fix_success',
            wrong_onemap_serial: wrongSerial || null,
            displaced_serial: wrongSerial || null,
            displaced_activated: displacedInfo?.activated ?? null,
            displaced_owner_dr: displacedInfo?.ownerDr ?? null,
            displaced_owner_team: displacedInfo?.ownerTeam ?? null,
            totalRecords,
            updatedCount,
            alreadyCorrectCount,
            allPropUpdates: allPropUpdates.map((u: { propId: string; updated?: boolean; oldValue?: string | null; ont?: { updated: boolean; oldValue: string | null } }) => ({
              propId: u.propId,
              oldValue: 'ont' in u ? u.ont?.oldValue : u.oldValue,
              updated: 'ont' in u ? u.ont?.updated : u.updated,
            })),
          }),
        ]
      );

      // If UPS serial was also updated, record that too
      if (hasUpsSerial && 'ups' in result && result.ups.updated) {
        await client.query(
          `INSERT INTO serial_change_history
           (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
           VALUES ($1, 'ups_serial', $2, $3, 'olt_report_fix', 'swap_correction', $4, $5)`,
          [
            drNumber,
            result.ups.oldValue || null,
            result.ups.newValue,
            userId || 'system',
            JSON.stringify({ propId, source: 'olt_report', fix_type: 'ups_swap_correction' }),
          ]
        );
      }

      return {
        drNumber,
        success: true,
        propId: 'propId' in result ? result.propId : null,
        oldValue: 'ont' in result ? result.ont.oldValue : result.oldValue,
        newValue: correctSerial,
        alreadyCorrect,
        upsSerial: hasUpsSerial && 'ups' in result
          ? { oldValue: result.ups.oldValue, newValue: result.ups.newValue, updated: result.ups.updated }
          : undefined,
      };
    } else {
      // Check if DR was not found in 1Map - move to investigate
      const notFoundError = result.error?.toLowerCase().includes('not found');

      if (notFoundError) {
        await client.query(
          `UPDATE olt_mismatch_records
           SET fix_status = 'not_found',
               fix_attempted_at = NOW(),
               fix_result = $1
           WHERE drop_number = $2
             AND fix_status = 'pending'`,
          ['DR not found in 1Map', drNumber]
        );

        await logActivity(
          drNumber,
          'INVESTIGATE',
          {
            details: `DR not found in 1Map layer 5121 - moved to investigate`,
            source: 'olt_report',
            fix_type: 'not_found',
          },
          userId || 'system'
        );

        log.info('FixOneMap', 'DR not found in 1Map - moved to investigate', { drNumber });

        return {
          drNumber,
          success: false,
          propId: null,
          oldValue: null,
          newValue: correctSerial,
          error: 'Not found in 1Map - moved to investigate',
        };
      }

      // Record failure in offline_devices (if exists)
      await client.query(
        `UPDATE offline_devices
         SET onemap_fix_attempted = true,
             onemap_fix_result = 'failed',
             onemap_fix_at = NOW()
         WHERE drop_number = $1`,
        [drNumber]
      );

      // Record failure in olt_mismatch_records
      await client.query(
        `UPDATE olt_mismatch_records
         SET fix_attempted_at = NOW(),
             fix_result = $1
         WHERE drop_number = $2
           AND fix_status = 'pending'`,
        [result.error || 'Unknown error', drNumber]
      );

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
        propId: 'propId' in result ? result.propId : null,
        oldValue: 'ont' in result ? result.ont.oldValue : result.oldValue,
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
      return apiResponse.success(res, result); // Still 200 but success: false in result
    }
  } catch (error) {
    log.error('FixOneMap', 'API error', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
