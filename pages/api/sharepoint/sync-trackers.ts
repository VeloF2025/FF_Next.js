/**
 * SP Tracker Sync API
 * POST /api/sharepoint/sync-trackers
 *
 * Syncs SharePoint tracker data (Lawley, Mohadin, Mamelodi) into:
 * - sp_pon_tracker (PON-level detail)
 * - sp_project_summary (project summary metrics)
 *
 * Requires auth.
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
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  try {
    const configs = await sql<SpTrackerConfig[]>`
      SELECT id, project_id, project_name, drive_id, item_id, sheet_name
      FROM sp_tracker_config
      WHERE enabled = true
    `;

    if (!configs.length) {
      return apiResponse.success(res, {
        synced: 0,
        projects: [],
        errors: [],
      });
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

    return apiResponse.success(res, {
      synced: totalSynced,
      projects: syncedProjects,
      errors,
    });
  } catch (err) {
    log.error('Tracker sync failed', { err }, 'sharepoint/sync-trackers');
    return apiResponse.internalError(res, 'Sync failed');
  }
}

export default withAuth(handler);
