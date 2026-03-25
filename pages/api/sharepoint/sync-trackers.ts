/**
 * SP Tracker Sync API
 * POST /api/sharepoint/sync-trackers
 *
 * Syncs SharePoint tracker data (Lawley, Mohadin, Mamelodi) into:
 * - sp_pon_tracker (PON-level detail)
 * - sp_project_summary (project summary metrics)
 *
 * Requires admin role.
 */

import type { NextApiResponse } from 'next';
import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { syncTrackerForProject } from '@/lib/sharepoint-sync/sync';
import type { SpTrackerConfig } from '@/lib/sharepoint-sync/types';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json(apiResponse(false, 'Method not allowed'));
    return;
  }

  try {
    const configs = await sql<SpTrackerConfig[]>`
      SELECT id, project_id, project_name, drive_id, item_id, sheet_name
      FROM sp_tracker_config
      WHERE enabled = true
    `;

    if (!configs.length) {
      res.status(200).json(
        apiResponse(true, 'No trackers enabled', {
          synced: 0,
          projects: [],
          errors: [],
        })
      );
      return;
    }

    let totalSynced = 0;
    const syncedProjects: string[] = [];
    const errors: string[] = [];

    for (const config of configs) {
      const result = await syncTrackerForProject(config);
      if (result.error) {
        errors.push(result.error);
      } else {
        totalSynced += result.synced;
        syncedProjects.push(config.project_name);
      }
    }

    res.status(200).json(
      apiResponse(true, 'Sync complete', {
        synced: totalSynced,
        projects: syncedProjects,
        errors,
      })
    );
  } catch (err) {
    log.error('Tracker sync failed', { err }, 'sharepoint/sync-trackers');
    res.status(500).json(apiResponse(false, 'Sync failed'));
  }
}

export default withAuth(handler);
