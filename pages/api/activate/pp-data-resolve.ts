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

const logger = createLogger('PPDataResolve');

export const config = {
  maxDuration: 300, // 5 minutes for 1Map serial lookups
};

/**
 * Run local resolution against existing DB tables
 */
async function runLocalResolution(): Promise<{
  matched_oes: number;
  matched_unified: number;
  matched_onemap: number;
  total_resolved: number;
}> {
  const results = { matched_oes: 0, matched_unified: 0, matched_onemap: 0, total_resolved: 0 };

  // 1. Match against oes_activations.serial_number
  const oesResult = await pool.query(`
    UPDATE oes_pp_data pp
    SET resolution_status = 'located_oes',
        resolved_drop_number = oa.drop_number,
        resolved_source = 'oes_activations',
        resolved_details = jsonb_build_object(
          'activation_date', oa.activation_date::text,
          'status', oa.status,
          'team', oa.team
        ),
        resolved_at = NOW(),
        updated_at = NOW()
    FROM oes_activations oa
    WHERE pp.serial_number = oa.serial_number
      AND pp.resolution_status = 'not_found'
  `);
  results.matched_oes = oesResult.rowCount || 0;

  // 2. Match against dr_photo_unified_reviews (oes_serial or ont_serial_scanned)
  const unifiedResult = await pool.query(`
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
        resolved_at = NOW(),
        updated_at = NOW()
    FROM dr_photo_unified_reviews ur
    WHERE (ur.oes_serial = pp.serial_number OR ur.ont_serial_scanned = pp.serial_number)
      AND pp.resolution_status = 'not_found'
  `);
  results.matched_unified = unifiedResult.rowCount || 0;

  // 3. Match against onemap_properties.ont_barcode
  try {
    const onemapResult = await pool.query(`
      UPDATE oes_pp_data pp
      SET resolution_status = 'located_onemap',
          resolved_drop_number = op.drop_number,
          resolved_source = 'onemap_properties',
          resolved_details = jsonb_build_object(
            'site', op.site,
            'pole', op.pole
          ),
          resolved_at = NOW(),
          updated_at = NOW()
      FROM onemap_properties op
      WHERE op.ont_barcode = pp.serial_number
        AND pp.resolution_status = 'not_found'
    `);
    results.matched_onemap = onemapResult.rowCount || 0;
  } catch (err) {
    logger.warn('onemap_properties lookup skipped', { error: String(err) });
  }

  results.total_resolved = results.matched_oes + results.matched_unified + results.matched_onemap;
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

  // Get all unresolved serials
  const unresolvedResult = await pool.query(`
    SELECT id, serial_number, project
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
    ORDER BY project, serial_number
  `);

  if (unresolvedResult.rows.length === 0) {
    logger.info('No unresolved records for 1Map lookup');
    return results;
  }

  logger.info('Starting per-serial 1Map lookup', {
    totalSerials: unresolvedResult.rows.length,
  });

  const client = createOneMapClient();
  await client.authenticate();

  // Process serials sequentially with rate limiting
  for (const row of unresolvedResult.rows) {
    const serial = row.serial_number as string;
    const project = row.project as string;
    const ppId = row.id as number;
    results.total_searched++;

    try {
      const searchResult = await client.searchInstallations(serial, { limit: 10 });

      if (searchResult.success && searchResult.result && searchResult.result.length > 0) {
        // Find best match: check if serial appears in any field of any result
        const match = searchResult.result[0]; // Top result from 1Map search

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
            match.drp || null,
            JSON.stringify({
              pole: match.pole,
              site: match.site,
              prop_id: match.prop_id,
              matched_in: 'full_text_search',
              search_results_count: searchResult.result.length,
            }),
            ppId,
          ]);
          results.total_resolved++;

          logger.debug('Serial matched via 1Map search', {
            serial, project, dr: match.drp, pole: match.pole,
          });
        } else {
          // Results returned but serial not actually in the data (false positive)
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

    // Rate limit: 200ms between requests to avoid overwhelming 1Map
    await new Promise(resolve => setTimeout(resolve, 200));

    // Log progress every 50 serials
    if (results.total_searched % 50 === 0) {
      logger.info('1Map lookup progress', {
        searched: results.total_searched,
        total: unresolvedResult.rows.length,
        resolved: results.total_resolved,
        elapsed: `${Math.round((Date.now() - startTime) / 1000)}s`,
      });
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  // Log to data_sync_operations
  try {
    await pool.query(
      `INSERT INTO data_sync_operations (operation_type, status, started_at, completed_at, details, triggered_by)
       VALUES ('pp_data_1map_lookup', 'success', NOW(), NOW(), $1, 'pp_data_resolve')`,
      [JSON.stringify({
        ...results,
        elapsed_seconds: elapsed,
        method: 'per_serial_search',
      })]
    );
  } catch (logErr) {
    logger.warn('Failed to log to data_sync_operations', {
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  }

  logger.info('1Map per-serial lookup complete', { ...results, elapsed_seconds: elapsed });
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
      const result = await runLocalResolution();
      return res.status(200).json({ success: true, data: result });
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

    return res.status(400).json({ error: 'Invalid action. Use "local-scan" or "1map-lookup".' });
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
