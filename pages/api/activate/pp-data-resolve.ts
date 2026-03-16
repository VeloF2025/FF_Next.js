/**
 * API Route: /api/activate/pp-data-resolve
 *
 * Purpose: Resolve PP (Pre-Provision) ONT serials to their actual DR numbers
 * Method: POST
 *
 * Actions:
 * - local-scan: Match unresolved serials against local DB tables
 * - 1map-lookup: Per-serial search via 1Map API (searches ALL fields, not just ph_ont)
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { createLogger } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import pool from '@/lib/db';
import { createOneMapClient } from '@/services/onemap';
import { extractWaPhotoSerials } from '@/modules/activate/services/serialVerificationService';
import { logTicketActivity } from '@/modules/noc/services/ticketService';

const logger = createLogger('PPDataResolve');

export const config = {
  maxDuration: 300, // 5 minutes for 1Map serial lookups
};

/** Status label map for human-readable activity descriptions */
const STATUS_LABELS: Record<string, string> = {
  located_oes: 'Found (OES)',
  located_unified: 'Found (Unified)',
  located_onemap: 'Found (OneMap)',
  located_1map: 'Found (1Map)',
  located_local: 'Found (Local)',
  activated: 'Activated',
  not_found: 'Not Found',
};

/**
 * After a bulk resolution step, find PP records that were just resolved
 * AND have a linked NOC ticket. Log an activity on each linked ticket.
 *
 * Uses resolved_at >= cutoff to find recently-resolved records.
 */
async function syncTicketActivities(cutoffTime: Date): Promise<number> {
  try {
    const result = await pool.query(`
      SELECT pp.serial_number, pp.resolution_status, pp.resolved_source,
             pp.resolved_drop_number, pp.maintenance_ticket_id
      FROM oes_pp_data pp
      WHERE pp.maintenance_ticket_id IS NOT NULL
        AND pp.resolved_at >= $1
    `, [cutoffTime.toISOString()]);

    if (result.rows.length === 0) return 0;

    let logged = 0;
    for (const row of result.rows) {
      const statusLabel = STATUS_LABELS[row.resolution_status] || row.resolution_status;
      try {
        await logTicketActivity({
          ticketId: row.maintenance_ticket_id,
          activityType: 'update',
          description: `PP Data: Serial ${row.serial_number} status changed to ${statusLabel} (source: ${row.resolved_source || 'unknown'}${row.resolved_drop_number ? `, DR: ${row.resolved_drop_number}` : ''})`,
          fieldChanges: {
            pp_resolution_status: { from: 'not_found', to: row.resolution_status },
            ...(row.resolved_drop_number ? { pp_resolved_dr: { from: null, to: row.resolved_drop_number } } : {}),
          },
          userName: 'System',
          userEmail: 'system@fibreflow.app',
        });
        logged++;
      } catch (err) {
        logger.warn('Failed to log PP status change to ticket', {
          ticketId: row.maintenance_ticket_id,
          serial: row.serial_number,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (logged > 0) {
      logger.info('Synced PP status changes to NOC tickets', { logged, total: result.rows.length });
    }
    return logged;
  } catch (err) {
    logger.warn('syncTicketActivities failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/**
 * Log a single PP status change to its linked NOC ticket (used by per-serial 1Map lookup).
 */
async function logPPStatusChangeToTicket(
  ticketId: string,
  serial: string,
  newStatus: string,
  source: string,
  drNumber: string | null,
): Promise<void> {
  const statusLabel = STATUS_LABELS[newStatus] || newStatus;
  await logTicketActivity({
    ticketId,
    activityType: 'update',
    description: `PP Data: Serial ${serial} status changed to ${statusLabel} (source: ${source}${drNumber ? `, DR: ${drNumber}` : ''})`,
    fieldChanges: {
      pp_resolution_status: { from: 'not_found', to: newStatus },
      ...(drNumber ? { pp_resolved_dr: { from: null, to: drNumber } } : {}),
    },
    userName: 'System',
    userEmail: 'system@fibreflow.app',
  });
}

/**
 * Run local resolution against ALL DB tables that might contain ONT serial data.
 * Each source is wrapped in try/catch so missing tables don't break the scan.
 */
async function runLocalResolution(): Promise<{
  matched_oes: number;
  matched_unified: number;
  matched_onemap: number;
  matched_local: number;
  total_resolved: number;
  sources: Record<string, number>;
}> {
  const sources: Record<string, number> = {};
  let matchedLocal = 0;

  // Helper: run a single source match, return count
  const matchSource = async (
    name: string,
    status: string,
    query: string,
  ): Promise<number> => {
    try {
      const result = await pool.query(query);
      const count = result.rowCount || 0;
      if (count > 0) {
        sources[name] = count;
        logger.info(`PP local match: ${name}`, { count });
      }
      return count;
    } catch (err) {
      logger.warn(`PP local match skipped: ${name}`, { error: String(err) });
      return 0;
    }
  };

  // === PRIMARY SOURCES ===

  // 1. oes_activations.serial_number
  const matchedOes = await matchSource('oes_activations', 'located_oes', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_oes',
        resolved_drop_number = oa.drop_number,
        resolved_source = 'oes_activations',
        resolved_details = jsonb_build_object(
          'activation_date', oa.activation_date::text,
          'status', oa.status,
          'team', oa.team
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM oes_activations oa
    WHERE pp.serial_number = oa.serial_number
      AND pp.resolution_status = 'not_found'
  `);

  // 2. dr_photo_unified_reviews (oes_serial or ont_serial_scanned)
  const matchedUnified = await matchSource('dr_photo_unified_reviews', 'located_unified', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_unified',
        resolved_drop_number = ur.drop_number,
        resolved_source = 'dr_photo_unified_reviews',
        resolved_details = jsonb_build_object(
          'matched_field', CASE
            WHEN ur.oes_serial = pp.serial_number THEN 'oes_serial'
            ELSE 'ont_serial_scanned'
          END,
          'project', ur.project
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM dr_photo_unified_reviews ur
    WHERE (ur.oes_serial = pp.serial_number OR ur.ont_serial_scanned = pp.serial_number)
      AND pp.resolution_status = 'not_found'
  `);

  // 3. onemap_properties.ont_barcode
  const matchedOnemap = await matchSource('onemap_properties', 'located_onemap', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_onemap',
        resolved_drop_number = op.drop_number,
        resolved_source = 'onemap_properties',
        resolved_details = jsonb_build_object('site', op.site, 'pole', op.pole),
        resolved_at = NOW(), updated_at = NOW()
    FROM onemap_properties op
    WHERE op.ont_barcode = pp.serial_number
      AND pp.resolution_status = 'not_found'
  `);

  // === ADDITIONAL SOURCES (all use 'located_local' status) ===

  // 4. drops.ont_serial — SOW field installation data
  matchedLocal += await matchSource('drops', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = d.drop_number,
        resolved_source = 'drops',
        resolved_details = jsonb_build_object(
          'project_id', d.project_id::text,
          'status', d.status
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM drops d
    WHERE d.ont_serial = pp.serial_number
      AND pp.resolution_status = 'not_found'
  `);

  // 5. stock_serials — Stock tracking system (serial → installed DR)
  matchedLocal += await matchSource('stock_serials', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = ss.installed_at_drop_number,
        resolved_source = 'stock_serials',
        resolved_details = jsonb_build_object(
          'status', ss.status,
          'installed_date', ss.installed_date::text
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM stock_serials ss
    WHERE ss.serial_number = pp.serial_number
      AND ss.installed_at_drop_number IS NOT NULL
      AND pp.resolution_status = 'not_found'
  `);

  // 6. foto_ai_reviews — VLM-extracted serials from QA photos (step6 + step9)
  matchedLocal += await matchSource('foto_ai_reviews', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = fr.drop_number,
        resolved_source = 'foto_ai_reviews',
        resolved_details = jsonb_build_object(
          'matched_field', CASE
            WHEN fr.vlm_ont_serial_step6 = pp.serial_number THEN 'vlm_ont_serial_step6'
            ELSE 'vlm_ont_serial_step9'
          END
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM foto_ai_reviews fr
    WHERE (fr.vlm_ont_serial_step6 = pp.serial_number OR fr.vlm_ont_serial_step9 = pp.serial_number)
      AND pp.resolution_status = 'not_found'
  `);

  // 7. wa_photos — WhatsApp photo VLM-extracted ONT serials
  matchedLocal += await matchSource('wa_photos', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = wp.drop_number,
        resolved_source = 'wa_photos',
        resolved_details = jsonb_build_object(
          'vlm_confidence', wp.vlm_confidence::text,
          'purpose', wp.purpose
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM wa_photos wp
    WHERE wp.vlm_ont_serial = pp.serial_number
      AND wp.drop_number IS NOT NULL
      AND pp.resolution_status = 'not_found'
  `);

  // 8. serial_change_history — Audit trail (old/new serial values linked to DRs)
  matchedLocal += await matchSource('serial_change_history', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = sch.drop_number,
        resolved_source = 'serial_change_history',
        resolved_details = jsonb_build_object(
          'matched_field', CASE
            WHEN sch.new_value = pp.serial_number THEN 'new_value'
            ELSE 'old_value'
          END,
          'change_type', sch.change_type,
          'change_source', sch.change_source
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM serial_change_history sch
    WHERE (sch.new_value = pp.serial_number OR sch.old_value = pp.serial_number)
      AND sch.change_type = 'ont_serial'
      AND pp.resolution_status = 'not_found'
  `);

  // 9. offline_devices — serial, expected_serial, or olt_serial
  matchedLocal += await matchSource('offline_devices', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = od.drop_number,
        resolved_source = 'offline_devices',
        resolved_details = jsonb_build_object(
          'matched_field', CASE
            WHEN od.serial_number = pp.serial_number THEN 'serial_number'
            WHEN od.expected_serial = pp.serial_number THEN 'expected_serial'
            ELSE 'olt_serial'
          END,
          'serial_mismatch', od.serial_mismatch
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM offline_devices od
    WHERE (od.serial_number = pp.serial_number
        OR od.expected_serial = pp.serial_number
        OR od.olt_serial = pp.serial_number)
      AND od.drop_number IS NOT NULL
      AND pp.resolution_status = 'not_found'
  `);

  // 10. olt_mismatch_records — OLT serial correction records
  matchedLocal += await matchSource('olt_mismatch_records', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = om.drop_number,
        resolved_source = 'olt_mismatch_records',
        resolved_details = jsonb_build_object(
          'matched_field', CASE
            WHEN om.olt_serial = pp.serial_number THEN 'olt_serial'
            ELSE 'wrong_onemap_serial'
          END,
          'fix_status', om.fix_status
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM olt_mismatch_records om
    WHERE (om.olt_serial = pp.serial_number OR om.wrong_onemap_serial = pp.serial_number)
      AND pp.resolution_status = 'not_found'
  `);

  // 11. arch_offline_devices — Historical OLT network snapshots
  matchedLocal += await matchSource('arch_offline_devices', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = aod.drop_number,
        resolved_source = 'arch_offline_devices',
        resolved_details = jsonb_build_object(
          'oes_status', aod.oes_status,
          'last_down_reason', aod.last_down_reason
        ),
        resolved_at = NOW(), updated_at = NOW()
    FROM arch_offline_devices aod
    WHERE aod.serial_number = pp.serial_number
      AND aod.drop_number IS NOT NULL
      AND pp.resolution_status = 'not_found'
  `);

  // 12. onemap_installations — Separate from onemap_properties
  matchedLocal += await matchSource('onemap_installations', 'located_local', `
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_local',
        resolved_drop_number = op.drop_number,
        resolved_source = 'onemap_installations',
        resolved_details = jsonb_build_object('property_id', oi.property_id::text),
        resolved_at = NOW(), updated_at = NOW()
    FROM onemap_installations oi
    JOIN onemap_properties op ON op.id = oi.property_id
    WHERE oi.ont_barcode = pp.serial_number
      AND op.drop_number IS NOT NULL
      AND pp.resolution_status = 'not_found'
  `);

  const totalResolved = matchedOes + matchedUnified + matchedOnemap + matchedLocal;
  const results = {
    matched_oes: matchedOes,
    matched_unified: matchedUnified,
    matched_onemap: matchedOnemap,
    matched_local: matchedLocal,
    total_resolved: totalResolved,
    sources,
  };

  logger.info('Local resolution complete', results);
  return results;
}

/**
 * Resolve via 1Map API per-serial search
 * Searches each unresolved serial individually — 1Map full-text search checks ALL fields
 * (ph_ont, drp, address, etc.), finding matches the old bulk ph_ont approach missed.
 */
async function run1MapLookup(): Promise<{
  total_resolved: number;
  total_searched: number;
  total_not_found: number;
  total_errors: number;
}> {
  const startTime = Date.now();
  const results = { total_resolved: 0, total_searched: 0, total_not_found: 0, total_errors: 0 };

  // Get all unresolved serials (include ticket link for activity logging)
  const unresolvedResult = await pool.query(`
    SELECT id, serial_number, project, maintenance_ticket_id
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
    ORDER BY project, serial_number
  `);

  if (unresolvedResult.rows.length === 0) {
    logger.info('No unresolved records for 1Map lookup');
    return results;
  }

  const totalSerials = unresolvedResult.rows.length;

  // Insert a "running" tracker row so the UI can poll progress
  let trackerId: number | null = null;
  try {
    const trackerResult = await pool.query(
      `INSERT INTO data_sync_operations (operation_type, status, started_at, details, triggered_by)
       VALUES ('pp_data_1map_lookup', 'running', NOW(), $1, 'pp_data_resolve')
       RETURNING id`,
      [JSON.stringify({ total: totalSerials, searched: 0, resolved: 0, not_found: 0, errors: 0, method: 'per_serial_search' })]
    );
    trackerId = trackerResult.rows[0]?.id || null;
  } catch (trackerErr) {
    logger.warn('Failed to create tracker row', { error: String(trackerErr) });
  }

  logger.info('Starting per-serial 1Map lookup', { totalSerials, trackerId });

  const client = createOneMapClient();
  await client.authenticate();

  // Helper to update progress in DB
  const updateProgress = async () => {
    if (!trackerId) return;
    try {
      await pool.query(
        `UPDATE data_sync_operations SET details = $1 WHERE id = $2`,
        [JSON.stringify({
          total: totalSerials,
          searched: results.total_searched,
          resolved: results.total_resolved,
          not_found: results.total_not_found,
          errors: results.total_errors,
          elapsed_seconds: Math.round((Date.now() - startTime) / 1000),
          method: 'per_serial_search',
        }), trackerId]
      );
    } catch { /* non-fatal */ }
  };

  // Process serials sequentially with rate limiting
  for (const row of unresolvedResult.rows) {
    const serial = row.serial_number as string;
    const project = row.project as string;
    const ppId = row.id as number;
    const ticketId = row.maintenance_ticket_id as string | null;
    results.total_searched++;

    try {
      // Wrap in a 45s timeout to prevent any single serial from hanging the entire loop
      const searchResult = await Promise.race([
        client.searchInstallations(serial, { limit: 10 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Serial search timeout (45s)')), 45_000)
        ),
      ]);

      if (searchResult.success && searchResult.result && searchResult.result.length > 0) {
        const match = searchResult.result[0] as Record<string, unknown> | undefined;
        if (!match) { results.total_not_found++; continue; }

        // Verify the serial actually appears in this record's data
        const recordStr = JSON.stringify(match).toUpperCase();
        const serialUpper = serial.toUpperCase();

        if (recordStr.includes(serialUpper)) {
          await pool.query(`
            UPDATE oes_pp_data
            SET resolution_status = 'located_1map',
                resolved_drop_number = $1,
                resolved_source = '1map_search',
                resolved_details = $2,
                resolved_at = NOW(),
                updated_at = NOW()
            WHERE id = $3
              AND resolution_status = 'not_found'
          `, [
            (match.drp as string) || null,
            JSON.stringify({
              pole: match.pole as string,
              site: match.site as string,
              prop_id: match.prop_id as string,
              matched_in: 'full_text_search',
              search_results_count: searchResult.result!.length,
            }),
            ppId,
          ]);
          results.total_resolved++;

          // Log activity to linked NOC ticket if one exists
          if (ticketId) {
            try {
              await logPPStatusChangeToTicket(ticketId, serial, 'located_1map', '1map_search', (match.drp as string) || null);
            } catch (actErr) {
              logger.warn('Failed to log 1Map match to ticket', { ticketId, serial, error: actErr instanceof Error ? actErr.message : String(actErr) });
            }
          }

          logger.debug('Serial matched via 1Map search', {
            serial, project, dr: match.drp as string, pole: match.pole as string,
          });
        } else {
          results.total_not_found++;
        }
      } else {
        results.total_not_found++;
      }
    } catch (err) {
      results.total_errors++;
      logger.warn('1Map search failed for serial', {
        serial,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Rate limit: 200ms between requests
    await new Promise(resolve => setTimeout(resolve, 200));

    // Update progress every 25 serials
    if (results.total_searched % 25 === 0) {
      await updateProgress();
      logger.info('1Map lookup progress', {
        searched: results.total_searched,
        total: totalSerials,
        resolved: results.total_resolved,
        elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
      });
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  // Mark tracker as complete
  if (trackerId) {
    try {
      await pool.query(
        `UPDATE data_sync_operations SET status = 'success', completed_at = NOW(), details = $1 WHERE id = $2`,
        [JSON.stringify({
          total: totalSerials,
          searched: results.total_searched,
          resolved: results.total_resolved,
          not_found: results.total_not_found,
          errors: results.total_errors,
          elapsed_seconds: elapsed,
          method: 'per_serial_search',
        }), trackerId]
      );
    } catch (logErr) {
      logger.warn('Failed to update tracker row', { error: String(logErr) });
    }
  }

  logger.info('1Map per-serial lookup complete', { ...results, elapsed_seconds: elapsed });
  return results;
}

/**
 * Cross-reference unresolved PP serials against WA-submitted DRs via BOSS API.
 *
 * For DRs that were submitted via WhatsApp but never had ont_serial_scanned saved,
 * re-query the BOSS API (1Map cache) to get the serial, then match against PPs.
 * Also backfills ont_serial_scanned on the unified_reviews record for future scans.
 */
async function runWACrossReference(): Promise<{
  total_drs_checked: number;
  total_resolved: number;
  total_backfilled: number;
  total_errors: number;
}> {
  const BOSS_API_HOST = process.env.BOSS_API_HOST || 'http://100.96.203.105:8003';
  const results = { total_drs_checked: 0, total_resolved: 0, total_backfilled: 0, total_errors: 0 };

  // Get unresolved PP serials grouped by project
  const unresolvedResult = await pool.query(`
    SELECT id, serial_number, project, date_registered
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
    ORDER BY project, date_registered DESC
  `);

  if (unresolvedResult.rows.length === 0) {
    logger.info('WA cross-ref: no unresolved PPs');
    return results;
  }

  // Build a lookup map: serial → PP record(s)
  const serialToPP = new Map<string, Array<{ id: number; project: string; date_registered: string }>>();
  for (const row of unresolvedResult.rows) {
    const serial = (row.serial_number as string).toUpperCase();
    if (!serialToPP.has(serial)) serialToPP.set(serial, []);
    serialToPP.get(serial)!.push({
      id: row.id as number,
      project: row.project as string,
      date_registered: row.date_registered as string,
    });
  }

  // Get WA-submitted DRs that have no ont_serial_scanned — these are the gap
  // Limit to DRs from the last 30 days with onemap_status='found' (serial was available at ACK time)
  const drsResult = await pool.query(`
    SELECT drop_number, project, wa_received_at
    FROM dr_photo_unified_reviews
    WHERE ont_serial_scanned IS NULL
      AND onemap_status = 'found'
      AND wa_group_jid IS NOT NULL
      AND created_at > NOW() - INTERVAL '30 days'
    ORDER BY created_at DESC
  `);

  if (drsResult.rows.length === 0) {
    logger.info('WA cross-ref: no DRs with missing serials to check');
    return results;
  }

  logger.info('WA cross-ref: checking DRs via BOSS API', {
    unresolvedPPs: unresolvedResult.rows.length,
    drsToCheck: drsResult.rows.length,
  });

  // For each DR, query BOSS API to get the ONT serial
  for (const dr of drsResult.rows) {
    const dropNumber = dr.drop_number as string;
    results.total_drs_checked++;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) continue;

      const data = await response.json() as { ont_barcode?: string | null; ups_serial?: string | null };
      if (!data.ont_barcode) continue;

      // Extract clean serial from barcode format: (S)SERIAL(23S)...
      let ontSerial = data.ont_barcode;
      const serialMatch = ontSerial.match(/\(S\)([^(]+)/);
      if (serialMatch && serialMatch[1]) {
        ontSerial = serialMatch[1].trim();
      } else if (!ontSerial.includes('(')) {
        ontSerial = ontSerial.trim();
      }

      const ontUpper = ontSerial.toUpperCase();

      // Backfill ont_serial_scanned on the unified_reviews record
      await pool.query(`
        UPDATE dr_photo_unified_reviews
        SET ont_serial_scanned = $1,
            ups_serial_scanned = COALESCE(ups_serial_scanned, $2),
            updated_at = NOW()
        WHERE drop_number = $3
          AND ont_serial_scanned IS NULL
      `, [ontSerial, data.ups_serial || null, dropNumber]);
      results.total_backfilled++;

      // Check if this serial matches any unresolved PP
      const ppMatches = serialToPP.get(ontUpper);
      if (ppMatches && ppMatches.length > 0) {
        for (const pp of ppMatches) {
          await pool.query(`
            UPDATE oes_pp_data
            SET resolution_status = 'located_unified',
                resolved_drop_number = $1,
                resolved_source = 'wa_cross_reference',
                resolved_details = jsonb_build_object(
                  'method', 'boss_api_backfill',
                  'project', $2,
                  'ont_serial', $3
                ),
                resolved_at = NOW(), updated_at = NOW()
            WHERE id = $4
              AND resolution_status = 'not_found'
          `, [dropNumber, dr.project || pp.project, ontSerial, pp.id]);
          results.total_resolved++;
        }
        // Remove from map so we don't double-match
        serialToPP.delete(ontUpper);
      }
    } catch (err) {
      results.total_errors++;
      if (err instanceof Error && err.name !== 'AbortError') {
        logger.warn('WA cross-ref: BOSS API error', { dropNumber, error: err.message });
      }
    }

    // Rate limit: 100ms between BOSS API calls (local network, fast)
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info('WA cross-ref complete', results);
  return results;
}

/**
 * Layer 4: Scan WA photos via VLM for unresolved PP serials.
 *
 * For PPs we still can't link to a DR, find WA activation photos from the same
 * date range that haven't been VLM-processed yet. Run VLM on them to extract
 * ONT serials, then match against unresolved PP serials.
 *
 * This catches cases where:
 * - The technician sent a sticker photo but VLM never ran on it
 * - The VLM result wasn't matched because the photo's DR had no serial stored
 */
async function runWAPhotoVLMScan(): Promise<{
  total_photos_found: number;
  total_vlm_processed: number;
  total_pp_matched: number;
  total_errors: number;
  drs_scanned: number;
}> {
  const results = {
    total_photos_found: 0,
    total_vlm_processed: 0,
    total_pp_matched: 0,
    total_errors: 0,
    drs_scanned: 0,
  };

  // Get unresolved PP date range to scope the photo search
  const ppDatesResult = await pool.query(`
    SELECT DISTINCT date_registered
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
      AND date_registered IS NOT NULL
    ORDER BY date_registered DESC
    LIMIT 14
  `);

  if (ppDatesResult.rows.length === 0) {
    logger.info('WA photo VLM scan: no unresolved PPs with dates');
    return results;
  }

  // Build PP serial lookup
  const ppSerialsResult = await pool.query(`
    SELECT id, serial_number, project
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
  `);
  const serialToPP = new Map<string, Array<{ id: number; project: string }>>();
  for (const row of ppSerialsResult.rows) {
    const serial = (row.serial_number as string).toUpperCase();
    if (!serialToPP.has(serial)) serialToPP.set(serial, []);
    serialToPP.get(serial)!.push({ id: row.id as number, project: row.project as string });
  }

  const dates = ppDatesResult.rows.map(r => r.date_registered as string);
  const minDate = dates[dates.length - 1];
  const maxDate = dates[0];

  // Find DRs that have unprocessed WA photos in the date range
  const photoDrsResult = await pool.query(`
    SELECT DISTINCT wp.drop_number
    FROM wa_photos wp
    WHERE wp.purpose = 'activation'
      AND wp.drop_number IS NOT NULL
      AND wp.vlm_processed = false
      AND wp.message_timestamp >= $1::date
      AND wp.message_timestamp < ($2::date + INTERVAL '1 day')
    ORDER BY wp.drop_number
  `, [minDate, maxDate]);

  results.total_photos_found = photoDrsResult.rows.length;

  if (photoDrsResult.rows.length === 0) {
    // No unprocessed photos — check if already-processed photos match any PPs
    // This handles the case where VLM ran but scan #7 missed due to case mismatch
    const alreadyProcessedMatch = await pool.query(`
      UPDATE oes_pp_data pp
      SET resolution_status = 'located_local',
          resolved_drop_number = wp.drop_number,
          resolved_source = 'wa_photos_vlm_rescan',
          resolved_details = jsonb_build_object(
            'vlm_confidence', wp.vlm_confidence::text,
            'method', 'case_insensitive_rescan'
          ),
          resolved_at = NOW(), updated_at = NOW()
      FROM wa_photos wp
      WHERE UPPER(wp.vlm_ont_serial) = UPPER(pp.serial_number)
        AND wp.drop_number IS NOT NULL
        AND wp.vlm_processed = true
        AND pp.resolution_status = 'not_found'
    `);
    results.total_pp_matched = alreadyProcessedMatch.rowCount || 0;
    if (results.total_pp_matched > 0) {
      logger.info('WA photo VLM scan: matched via case-insensitive rescan', {
        matched: results.total_pp_matched,
      });
    }
    logger.info('WA photo VLM scan: no unprocessed photos in date range', { minDate, maxDate });
    return results;
  }

  logger.info('WA photo VLM scan: processing photos', {
    drsWithPhotos: photoDrsResult.rows.length,
    dateRange: `${minDate} to ${maxDate}`,
    unresolvedPPs: ppSerialsResult.rows.length,
  });

  // Process each DR's photos via VLM
  for (const row of photoDrsResult.rows) {
    const dropNumber = row.drop_number as string;
    results.drs_scanned++;

    try {
      const extraction = await extractWaPhotoSerials(dropNumber, {
        force: false, // Only unprocessed
        timeoutMs: 10000,
      });

      results.total_vlm_processed += extraction.photosProcessed;

      // Check if extracted serial matches any PP
      if (extraction.bestOnt) {
        const ontUpper = extraction.bestOnt.serial.toUpperCase();
        const ppMatches = serialToPP.get(ontUpper);
        if (ppMatches && ppMatches.length > 0) {
          for (const pp of ppMatches) {
            await pool.query(`
              UPDATE oes_pp_data
              SET resolution_status = 'located_local',
                  resolved_drop_number = $1,
                  resolved_source = 'wa_photo_vlm_scan',
                  resolved_details = jsonb_build_object(
                    'method', 'vlm_photo_extraction',
                    'vlm_ont_serial', $2,
                    'vlm_confidence', $3::text,
                    'project', $4
                  ),
                  resolved_at = NOW(), updated_at = NOW()
              WHERE id = $5
                AND resolution_status = 'not_found'
            `, [dropNumber, extraction.bestOnt.serial, extraction.bestOnt.confidence, pp.project, pp.id]);
            results.total_pp_matched++;
          }
          serialToPP.delete(ontUpper);
        }
      }

      logger.debug('WA photo VLM scan: processed DR', {
        dropNumber,
        photosProcessed: extraction.photosProcessed,
        ontFound: extraction.bestOnt?.serial || null,
      });
    } catch (err) {
      results.total_errors++;
      logger.warn('WA photo VLM scan: extraction failed', {
        dropNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('WA photo VLM scan complete', results);
  return results;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body;

  try {
    if (action === 'local-scan') {
      const cutoff = new Date();
      const result = await runLocalResolution();
      const ticketsUpdated = await syncTicketActivities(cutoff);
      return res.status(200).json({ success: true, data: { ...result, tickets_updated: ticketsUpdated } });
    }

    if (action === '1map-lookup') {
      // Fire-and-forget: searches each serial individually (~200ms/serial)
      run1MapLookup().catch(err => {
        logger.error('Background 1Map lookup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return res.status(200).json({
        success: true,
        data: { message: 'Per-serial 1Map search started. This searches ALL fields for each serial (~200ms each). Refresh periodically to see results.' },
      });
    }

    if (action === 'resolve-all') {
      // Pipeline: local-scan → WA cross-ref → WA photo VLM → 1Map (background)
      const cutoff = new Date();
      const localResult = await runLocalResolution();
      const crossRefResult = await runWACrossReference();
      const vlmResult = await runWAPhotoVLMScan();

      // Sync ticket activities for all records resolved in steps 1-3
      const ticketsUpdated = await syncTicketActivities(cutoff);

      // Fire-and-forget 1Map lookup for remaining unresolved serials (has its own progress tracker)
      // 1Map lookup logs ticket activities per-serial inline
      run1MapLookup().catch(err => {
        logger.error('Background 1Map lookup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

      return res.status(200).json({
        success: true,
        data: {
          total_resolved: localResult.total_resolved + crossRefResult.total_resolved + vlmResult.total_pp_matched,
          onemap_started: true,
          tickets_updated: ticketsUpdated,
          steps: {
            local_scan: { resolved: localResult.total_resolved, sources: localResult.sources },
            wa_cross_ref: { resolved: crossRefResult.total_resolved, drs_checked: crossRefResult.total_drs_checked, backfilled: crossRefResult.total_backfilled },
            wa_photo_vlm: { resolved: vlmResult.total_pp_matched, photos_processed: vlmResult.total_vlm_processed, drs_scanned: vlmResult.drs_scanned },
          },
        },
      });
    }

    return res.status(400).json({ error: 'Invalid action. Use "local-scan", "1map-lookup", or "resolve-all".' });
  } catch (error) {
    logger.error('Resolution failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Resolution failed',
    });
  }
}

export default withAuth(withRole('manager')(handler));
