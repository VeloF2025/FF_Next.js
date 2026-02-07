/**
 * Cross-DR Swap Fix API
 *
 * POST: Execute a cross-DR serial swap fix, updating 1Map and DB records
 *
 * Handles all 4 swap scenarios:
 * 1. clean_swap: Fix both DR A and DR B on 1Map
 * 2. fix_a_only: Fix DR A only (DR B already correct)
 * 3. fix_a_flag_b: Fix DR A, create new pending mismatch for DR B
 * 4. fix_a_b_missing: Fix DR A only (DR B not on 1Map)
 *
 * Request body:
 * - recordId: string (olt_mismatch_records id for DR A)
 * - drANumber: string
 * - drACorrectSerial: string (OES serial for DR A)
 * - drAWrongSerial: string (current wrong serial on DR A's 1Map)
 * - drBNumber: string
 * - drBCorrectSerial: string | null (OES serial for DR B)
 * - drBWrongSerial: string | null (current wrong serial on DR B's 1Map)
 * - scenario: 'clean_swap' | 'fix_a_only' | 'fix_a_flag_b' | 'fix_a_b_missing'
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';
import { logActivity } from '@/modules/activate/services/activityLogService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const config = {
  maxDuration: 60,
};

type SwapScenario = 'clean_swap' | 'fix_a_only' | 'fix_a_flag_b' | 'fix_a_b_missing';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const {
    recordId,
    drANumber,
    drACorrectSerial,
    drAWrongSerial,
    drBNumber,
    drBCorrectSerial,
    drBWrongSerial,
    scenario,
    upsTransfer,
  } = req.body as {
    recordId: string;
    drANumber: string;
    drACorrectSerial: string;
    drAWrongSerial: string;
    drBNumber: string;
    drBCorrectSerial: string | null;
    drBWrongSerial: string | null;
    scenario: SwapScenario;
    upsTransfer?: { needed: boolean; serial: string | null; from: string; to: string } | null;
  };

  if (!recordId || !drANumber || !drACorrectSerial || !drBNumber || !scenario) {
    return apiResponse.badRequest(res, 'recordId, drANumber, drACorrectSerial, drBNumber, and scenario are required');
  }

  const client = await pool.connect();
  const user = getAuthUser(req);
  const userId = user?.id || null;

  try {
    // Step 1: Fix DR A on 1Map
    const drAResult = await oneMapApi.fixDrOntSerial(drANumber, drACorrectSerial, drAWrongSerial);

    if (!drAResult.success) {
      return apiResponse.success(res, {
        success: false,
        error: `Failed to fix DR A (${drANumber}): ${drAResult.error}`,
        drAResult,
      });
    }

    const drAOldValue = 'ont' in drAResult ? drAResult.ont.oldValue : drAResult.oldValue;

    // Update DR A's mismatch record
    await client.query(
      `UPDATE olt_mismatch_records
       SET fix_status = 'fixed', fix_attempted_at = NOW(),
           fix_result = 'success', fix_old_value = $1, fix_by = $2
       WHERE id = $3`,
      [JSON.stringify({ ont_old: drAOldValue, ont_new: drACorrectSerial, swap_fix: true }), userId, recordId]
    );

    // Update DR A's offline_devices if exists
    await client.query(
      `UPDATE offline_devices
       SET onemap_fix_attempted = true, onemap_fix_result = 'success',
           onemap_fix_old_value = $1, onemap_fix_at = NOW(), onemap_fix_by = $2,
           mismatch_status = 'resolved', mismatch_resolution = 'data_corrected',
           mismatch_resolved_at = NOW(), mismatch_resolved_by = $3
       WHERE drop_number = $4`,
      [JSON.stringify({ ont_old: drAOldValue, ont_new: drACorrectSerial }), userId, userId, drANumber]
    );

    // Update DR A review summary
    await client.query(
      `UPDATE dr_photo_unified_reviews SET ont_serial_scanned = $1 WHERE drop_number = $2`,
      [drACorrectSerial, drANumber]
    );

    // Log activity for DR A
    await logActivity(
      drANumber,
      'SERIAL_UPDATE',
      {
        details: `CROSS-DR SWAP FIX: ONT serial ${drAOldValue || 'EMPTY'} → ${drACorrectSerial} (was swapped with ${drBNumber})`,
        source: 'olt_report',
        fix_type: 'cross_dr_swap',
        scenario,
        otherDr: drBNumber,
      },
      userId || 'system'
    );

    // Record DR A in serial_change_history
    await client.query(
      `INSERT INTO serial_change_history
       (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
       VALUES ($1, 'ont_serial', $2, $3, 'cross_dr_swap', 'data_fix', $4, $5)`,
      [
        drANumber,
        drAOldValue || null,
        drACorrectSerial,
        userId || 'system',
        JSON.stringify({ scenario, otherDr: drBNumber, source: 'olt_report' }),
      ]
    );

    // Step 2: Handle DR B based on scenario
    let drBFixResult = null;

    if (scenario === 'clean_swap' && drBCorrectSerial) {
      // Fix DR B on 1Map too
      drBFixResult = await oneMapApi.fixDrOntSerial(drBNumber, drBCorrectSerial, drBWrongSerial || undefined);

      if (drBFixResult.success) {
        const drBOldValue = 'ont' in drBFixResult ? drBFixResult.ont.oldValue : drBFixResult.oldValue;

        // Update DR B's mismatch record if it exists
        await client.query(
          `UPDATE olt_mismatch_records
           SET fix_status = 'fixed', fix_attempted_at = NOW(),
               fix_result = 'success', fix_old_value = $1, fix_by = $2
           WHERE drop_number = $3 AND fix_status IN ('pending', 'needs_investigation')`,
          [JSON.stringify({ ont_old: drBOldValue, ont_new: drBCorrectSerial, swap_fix: true }), userId, drBNumber]
        );

        // Update DR B review summary
        await client.query(
          `UPDATE dr_photo_unified_reviews SET ont_serial_scanned = $1 WHERE drop_number = $2`,
          [drBCorrectSerial, drBNumber]
        );

        // Log activity for DR B
        await logActivity(
          drBNumber,
          'SERIAL_UPDATE',
          {
            details: `CROSS-DR SWAP FIX: ONT serial ${drBOldValue || 'EMPTY'} → ${drBCorrectSerial} (was swapped with ${drANumber})`,
            source: 'olt_report',
            fix_type: 'cross_dr_swap',
            scenario,
            otherDr: drANumber,
          },
          userId || 'system'
        );

        // Record DR B in serial_change_history
        await client.query(
          `INSERT INTO serial_change_history
           (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
           VALUES ($1, 'ont_serial', $2, $3, 'cross_dr_swap', 'data_fix', $4, $5)`,
          [
            drBNumber,
            drBOldValue || null,
            drBCorrectSerial,
            userId || 'system',
            JSON.stringify({ scenario, otherDr: drANumber, source: 'olt_report' }),
          ]
        );
      }
    } else if (scenario === 'fix_a_flag_b' && drBCorrectSerial) {
      // Create or update DR B's mismatch record as pending
      const existing = await client.query(
        `SELECT id FROM olt_mismatch_records WHERE drop_number = $1 AND fix_status IN ('pending', 'needs_investigation')`,
        [drBNumber]
      );

      if (existing.rows.length === 0) {
        // Get the import_id from DR A's record for reference
        const importRef = await client.query(
          `SELECT import_id FROM olt_mismatch_records WHERE id = $1`,
          [recordId]
        );
        const importId = importRef.rows[0]?.import_id;

        await client.query(
          `INSERT INTO olt_mismatch_records
           (import_id, drop_number, olt_serial, wrong_onemap_serial, fix_status, detection_source, investigation_context)
           VALUES ($1, $2, $3, $4, 'pending', 'cross_dr_swap', $5)`,
          [
            importId,
            drBNumber,
            drBCorrectSerial,
            drBWrongSerial,
            JSON.stringify({
              reason: 'flagged_by_swap',
              message: `Flagged during cross-DR swap fix with ${drANumber}. DR B has wrong serial ${drBWrongSerial}, should be ${drBCorrectSerial}.`,
              flaggedFrom: drANumber,
            }),
          ]
        );
      }

      // Log activity for DR B
      await logActivity(
        drBNumber,
        'INVESTIGATE',
        {
          details: `Flagged during cross-DR swap: has wrong serial ${drBWrongSerial}, should be ${drBCorrectSerial}. Flagged from ${drANumber} swap.`,
          source: 'olt_report',
          fix_type: 'cross_dr_flag',
          flaggedFrom: drANumber,
        },
        userId || 'system'
      );
    }

    // Step 3: Handle UPS transfer (DR A has a UPS serial that belongs to DR B)
    let upsTransferResult = null;
    if (upsTransfer?.needed && upsTransfer.serial) {
      try {
        // Search DR B to get its prop_id, then update br_ser
        const drBSearchResult = await oneMapApi.searchDR(drBNumber);
        if (drBSearchResult.success && drBSearchResult.records.length > 0) {
          // Find the best target record: one with ONT but no UPS, or first record without UPS
          const drBRecord = drBSearchResult.records.find(r => r.ph_ont && !r.br_ser)
            || drBSearchResult.records.find(r => !r.br_ser)
            || drBSearchResult.records[0];
          const drBHasUps = drBSearchResult.records.some(r => r.br_ser);
          if (!drBHasUps) {
            // No record on DR B has a UPS — transfer it
            const currentOnt = drBRecord.ph_ont || drBCorrectSerial || '';
            const upsResult = await oneMapApi.updateOntAndUpsSerial(
              drBRecord.prop_id,
              currentOnt,
              upsTransfer.serial
            );
            if (upsResult.success) {
              upsTransferResult = { success: true, serial: upsTransfer.serial, to: drBNumber };

              // Clear UPS from DR A (it now belongs to DR B)
              const drASearchForUps = await oneMapApi.searchDR(drANumber);
              if (drASearchForUps.success) {
                const drAUpsRecord = drASearchForUps.records.find(r => r.br_ser?.toUpperCase() === upsTransfer.serial.toUpperCase());
                if (drAUpsRecord) {
                  await oneMapApi.updateOntAndUpsSerial(
                    drAUpsRecord.prop_id,
                    drAUpsRecord.ph_ont || drACorrectSerial,
                    '' // Clear UPS
                  );
                }
              }

              await logActivity(
                drBNumber,
                'SERIAL_UPDATE',
                {
                  details: `UPS TRANSFER: UPS serial ${upsTransfer.serial} transferred from ${drANumber} (was on wrong DR)`,
                  source: 'olt_report',
                  fix_type: 'ups_transfer',
                  fromDr: drANumber,
                },
                userId || 'system'
              );

              // Record UPS addition on DR B
              await client.query(
                `INSERT INTO serial_change_history
                 (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
                 VALUES ($1, 'ups_serial', $2, $3, 'cross_dr_swap', 'ups_transfer', $4, $5)`,
                [
                  drBNumber,
                  null,
                  upsTransfer.serial,
                  userId || 'system',
                  JSON.stringify({ fromDr: drANumber, source: 'olt_report' }),
                ]
              );

              // Record UPS removal from DR A
              await client.query(
                `INSERT INTO serial_change_history
                 (drop_number, change_type, old_value, new_value, change_source, change_reason, actor, metadata)
                 VALUES ($1, 'ups_serial', $2, $3, 'cross_dr_swap', 'ups_transfer', $4, $5)`,
                [
                  drANumber,
                  upsTransfer.serial,
                  null,
                  userId || 'system',
                  JSON.stringify({ toDr: drBNumber, source: 'olt_report' }),
                ]
              );
            } else {
              upsTransferResult = { success: false, error: upsResult.error };
            }
          }
        }
      } catch (upsErr) {
        log.error('SwapFix', 'UPS transfer failed (non-fatal)', { error: upsErr, drB: drBNumber });
        upsTransferResult = { success: false, error: 'UPS transfer failed' };
      }
    }

    log.info('SwapFix', 'Cross-DR swap completed', {
      drA: drANumber,
      drB: drBNumber,
      scenario,
      drASuccess: drAResult.success,
      drBSuccess: drBFixResult?.success ?? null,
      upsTransfer: upsTransferResult,
    });

    return apiResponse.success(res, {
      success: true,
      scenario,
      drA: { drNumber: drANumber, fixed: true, oldValue: drAOldValue, newValue: drACorrectSerial },
      drB: {
        drNumber: drBNumber,
        fixed: scenario === 'clean_swap' && drBFixResult?.success,
        flagged: scenario === 'fix_a_flag_b',
        error: drBFixResult && !drBFixResult.success ? drBFixResult.error : undefined,
      },
      upsTransfer: upsTransferResult,
    });
  } catch (error) {
    log.error('SwapFix', 'Swap fix failed', { error, drA: drANumber, drB: drBNumber });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
