/**
 * API Route: /api/activate/sync-installer-names
 *
 * Syncs installer_name from 1Map (via BOSS API) to drops.installed_by_name
 *
 * POST - Sync installer names for DRs missing this data
 *   - limit: Max number of DRs to process (default 100)
 *   - project: Filter by project name
 *   - force: Re-sync even if already populated
 *
 * GET - Check sync status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';

const BOSS_API_URL = process.env.BOSS_API_URL || 'http://100.96.203.105:8003';

interface BossRecord {
  dr_number: string;
  installer_name: string | null;
  signup_agent: string | null;
  status: string | null;
}

/**
 * Fetch installer_name from BOSS API for a single DR
 */
async function fetchInstallerFromBoss(drNumber: string): Promise<BossRecord | null> {
  try {
    const response = await fetch(`${BOSS_API_URL}/api/record/${drNumber}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`BOSS API error: ${response.status}`);
    }

    const data = await response.json();
    return {
      dr_number: data.dr_number || drNumber,
      installer_name: data.installer_name?.trim() || null,
      signup_agent: data.signup_agent?.trim() || null,
      status: data.status || null,
    };
  } catch (error) {
    log.warn('Failed to fetch from BOSS API', { drNumber, error });
    return null;
  }
}

/**
 * Get DRs that need installer_name sync
 */
async function getDRsNeedingSync(
  limit: number,
  project?: string,
  force?: boolean
): Promise<{ drop_number: string; project: string | null }[]> {
  let query = `
    SELECT DISTINCT d.drop_number, d.project_id, p.project_name as project
    FROM drops d
    LEFT JOIN projects p ON d.project_id = p.id
    WHERE d.drop_number IS NOT NULL
  `;

  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (!force) {
    query += ` AND (d.installed_by_name IS NULL OR d.installed_by_name = '')`;
  }

  if (project) {
    query += ` AND p.project_name = $${paramIndex++}`;
    params.push(project);
  }

  query += ` ORDER BY d.created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

/**
 * Update drops table with installer_name
 */
async function updateInstallerName(
  drNumber: string,
  installerName: string
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE drops SET installed_by_name = $1 WHERE drop_number = $2`,
    [installerName, drNumber]
  );
  return (result.rowCount ?? 0) > 0;
}

async function handlePost(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  const { limit = 100, project, force = false } = req.body;

  log.info('Starting installer name sync', { limit, project, force });

  try {
    // Get DRs needing sync
    const drs = await getDRsNeedingSync(
      Math.min(Number(limit), 500),
      project,
      force
    );

    if (drs.length === 0) {
      return apiResponse.success(res, {
        message: 'No DRs need installer sync',
        processed: 0,
        updated: 0,
        notFound: 0,
        errors: 0,
      });
    }

    log.info(`Found ${drs.length} DRs to sync`);

    const results = {
      processed: 0,
      updated: 0,
      notFound: 0,
      errors: 0,
      samples: [] as { dr: string; installer: string }[],
    };

    // Process in batches with small delay to avoid overwhelming BOSS API
    for (const dr of drs) {
      results.processed++;

      try {
        const bossRecord = await fetchInstallerFromBoss(dr.drop_number);

        if (!bossRecord || !bossRecord.installer_name) {
          results.notFound++;
          continue;
        }

        const updated = await updateInstallerName(
          dr.drop_number,
          bossRecord.installer_name
        );

        if (updated) {
          results.updated++;
          // Keep first 10 samples for response
          if (results.samples.length < 10) {
            results.samples.push({
              dr: dr.drop_number,
              installer: bossRecord.installer_name,
            });
          }
        }
      } catch (error) {
        results.errors++;
        log.error('Error syncing installer', { dr: dr.drop_number, error });
      }

      // Small delay every 10 requests
      if (results.processed % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    log.info('Installer sync completed', results);

    return apiResponse.success(res, {
      message: `Synced installer names for ${results.updated} DRs`,
      ...results,
    });
  } catch (error) {
    log.error('Installer sync failed', { error });
    return apiResponse.serverError(res, 'Sync failed');
  }
}

async function handleGet(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  try {
    // Get sync status
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total_drops,
        COUNT(*) FILTER (WHERE installed_by_name IS NOT NULL AND installed_by_name != '') as has_installer,
        COUNT(*) FILTER (WHERE installed_by_name IS NULL OR installed_by_name = '') as missing_installer
      FROM drops
      WHERE drop_number IS NOT NULL
    `);

    const stats = statsResult.rows[0];

    // Get sample of installers
    const sampleResult = await pool.query(`
      SELECT installed_by_name, COUNT(*) as count
      FROM drops
      WHERE installed_by_name IS NOT NULL AND installed_by_name != ''
      GROUP BY installed_by_name
      ORDER BY count DESC
      LIMIT 10
    `);

    return apiResponse.success(res, {
      stats: {
        total: parseInt(stats.total_drops),
        hasInstaller: parseInt(stats.has_installer),
        missingInstaller: parseInt(stats.missing_installer),
        percentComplete: stats.total_drops > 0
          ? Math.round((stats.has_installer / stats.total_drops) * 100)
          : 0,
      },
      topInstallers: sampleResult.rows,
    });
  } catch (error) {
    log.error('Failed to get sync status', { error });
    return apiResponse.serverError(res, 'Failed to get status');
  }
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
  }
}

export default withAuth(withRole(['admin', 'manager'], handler));
