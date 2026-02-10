/**
 * API Route: /api/activate/pp-data-resolve
 *
 * Purpose: Resolve PP (Pre-Provision) ONT serials to their actual DR numbers
 * Method: POST
 *
 * Actions:
 * - local-scan: Match unresolved serials against local DB tables
 * - 1map-lookup: Bulk lookup unresolved serials via 1Map API (ph_ont field)
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { createLogger } from '@/lib/logger';
import { withAuth, withRole } from '@/lib/auth';
import pool from '@/lib/db';
import { createOneMapClient, SITE_PROJECT_MAP } from '@/services/onemap';

const logger = createLogger('PPDataResolve');

export const config = {
  maxDuration: 300, // 5 minutes for 1Map bulk lookups
};

// Project name to 1Map site code mapping
const PROJECT_SITE_MAP: Record<string, string> = {
  'Lawley': 'LAW',
  'Mohadin': 'MOH',
  'Mamelodi': 'MAM',
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
 * Resolve via 1Map API bulk lookup
 * Fetches all installations per project, matches ph_ont field against unresolved serials
 */
async function run1MapLookup(): Promise<{
  total_resolved: number;
  by_project: Record<string, number>;
  total_fetched: number;
}> {
  const results: {
    total_resolved: number;
    by_project: Record<string, number>;
    total_fetched: number;
  } = { total_resolved: 0, by_project: {}, total_fetched: 0 };

  // Get unresolved serials grouped by project
  const unresolvedResult = await pool.query(`
    SELECT serial_number, project
    FROM oes_pp_data
    WHERE resolution_status = 'not_found'
    ORDER BY project
  `);

  if (unresolvedResult.rows.length === 0) {
    logger.info('No unresolved records for 1Map lookup');
    return results;
  }

  // Group serials by project
  const byProject = new Map<string, Set<string>>();
  for (const row of unresolvedResult.rows) {
    const project = row.project as string;
    if (!byProject.has(project)) byProject.set(project, new Set());
    byProject.get(project)!.add(row.serial_number as string);
  }

  logger.info('Starting 1Map lookup', {
    totalSerials: unresolvedResult.rows.length,
    projects: byProject.size,
  });

  const client = createOneMapClient();
  await client.authenticate();

  for (const [project, serials] of byProject) {
    const siteCode = PROJECT_SITE_MAP[project];
    if (!siteCode) {
      logger.warn(`No site code for project "${project}", skipping`);
      continue;
    }

    // Verify site code exists in 1Map config
    if (!SITE_PROJECT_MAP[siteCode]) {
      logger.warn(`Site code "${siteCode}" not in SITE_PROJECT_MAP, skipping`);
      continue;
    }

    logger.info(`Fetching installations for ${siteCode}`, { project });

    try {
      const records = await client.getAllInstallations(siteCode);
      results.total_fetched += records.length;

      // Build serial -> DR map from ph_ont field
      const serialToDR = new Map<string, { drp: string; pole: string; site: string; prop_id: string }>();
      for (const record of records) {
        const phOnt = record.ph_ont as string | undefined;
        if (phOnt && typeof phOnt === 'string' && phOnt.trim()) {
          serialToDR.set(phOnt.trim().toUpperCase(), {
            drp: record.drp,
            pole: record.pole,
            site: record.site,
            prop_id: record.prop_id,
          });
        }
      }

      logger.info(`Built serial map for ${siteCode}`, {
        entries: serialToDR.size,
        totalRecords: records.length,
      });

      // Match PP serials against the map
      let projectMatches = 0;
      const matchedSerials: { serial: string; drp: string; details: Record<string, unknown> }[] = [];

      for (const serial of serials) {
        const match = serialToDR.get(serial.toUpperCase());
        if (match) {
          matchedSerials.push({
            serial,
            drp: match.drp,
            details: { pole: match.pole, site: match.site, prop_id: match.prop_id },
          });
          projectMatches++;
        }
      }

      // Batch update matched records
      if (matchedSerials.length > 0) {
        const BATCH_SIZE = 100;
        for (let i = 0; i < matchedSerials.length; i += BATCH_SIZE) {
          const chunk = matchedSerials.slice(i, i + BATCH_SIZE);

          await pool.query(`
            UPDATE oes_pp_data pp
            SET resolution_status = 'located_1map',
                resolved_drop_number = data.drp,
                resolved_source = '1map_api',
                resolved_details = data.details,
                resolved_at = NOW(),
                updated_at = NOW()
            FROM (
              SELECT
                unnest($1::text[]) as serial,
                unnest($2::text[]) as drp,
                unnest($3::jsonb[]) as details
            ) data
            WHERE pp.serial_number = data.serial
              AND pp.project = $4
              AND pp.resolution_status = 'not_found'
          `, [
            chunk.map(m => m.serial),
            chunk.map(m => m.drp),
            chunk.map(m => JSON.stringify(m.details)),
            project,
          ]);
        }
      }

      results.by_project[project] = projectMatches;
      results.total_resolved += projectMatches;

      logger.info(`${siteCode} lookup complete`, {
        matched: projectMatches,
        total: serials.size,
      });
    } catch (err) {
      logger.error(`1Map lookup failed for ${siteCode}`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Log to data_sync_operations
  try {
    await pool.query(
      `INSERT INTO data_sync_operations (operation_type, status, started_at, completed_at, details, triggered_by)
       VALUES ('pp_data_1map_lookup', 'success', NOW(), NOW(), $1, 'pp_data_resolve')`,
      [JSON.stringify({
        total_resolved: results.total_resolved,
        by_project: results.by_project,
        total_fetched: results.total_fetched,
      })]
    );
  } catch (logErr) {
    logger.warn('Failed to log to data_sync_operations', {
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  }

  logger.info('1Map lookup complete', results);
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
      // Fire-and-forget: return immediately, run in background
      run1MapLookup().catch(err => {
        logger.error('Background 1Map lookup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return res.status(200).json({
        success: true,
        data: { message: 'Lookup started in background. Refresh in a few minutes to see results.' },
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
