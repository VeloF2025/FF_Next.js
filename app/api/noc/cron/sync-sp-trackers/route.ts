/**
 * SP Tracker Sync Cron Job API Route
 * POST /api/noc/cron/sync-sp-trackers - Trigger automatic sync job
 *
 * Syncs SharePoint tracker data from Lawley, Mohadin, Mamelodi projects
 * into sp_pon_tracker and sp_project_summary tables.
 *
 * Designed for Vercel Cron or external cron services.
 * Runs every hour: 0 * * * *
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { neon } from '@/lib/db-neon';
import { syncTrackerForProject } from '@/lib/sharepoint-sync/sync';
import type { SpTrackerConfig } from '@/lib/sharepoint-sync/types';

const logger = createLogger('maintenance:api:cron:sync-sp-trackers');
const sql = neon(process.env.DATABASE_URL || '');

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get('authorization');
      const providedSecret = authHeader?.replace('Bearer ', '');

      if (providedSecret !== cronSecret) {
        logger.warn('Unauthorized cron job trigger attempt');
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid cron secret',
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 401 }
        );
      }
    }

    logger.info('Cron job triggered: SP Tracker sync');

    const configs = await sql`
      SELECT id, project_id, project_name, drive_id, item_id, sheet_name
      FROM sp_tracker_config
      WHERE enabled = true
    ` as SpTrackerConfig[];

    let totalSynced = 0;
    const syncedProjects: string[] = [];
    const errors: string[] = [];

    for (const config of configs) {
      const result = await syncTrackerForProject(config);
      if (result.error) {
        errors.push(result.error);
        logger.error('Tracker sync failed', { projectName: config.project_name, error: result.error });
      } else {
        totalSynced += result.synced;
        syncedProjects.push(config.project_name);
        logger.info('Tracker synced', {
          projectName: config.project_name,
          rowsSynced: result.synced,
        });
      }
    }

    const duration = Date.now() - startTime;

    logger.info('Cron job completed', {
      total_synced: totalSynced,
      projects_synced: syncedProjects.length,
      errors_count: errors.length,
      duration_ms: duration,
    });

    return NextResponse.json(
      {
        success: errors.length === 0,
        data: {
          totalSynced,
          projects: syncedProjects,
          errors,
        },
        message: errors.length === 0 ? 'Sync completed successfully' : 'Sync completed with errors',
        meta: {
          timestamp: new Date().toISOString(),
          execution_time_ms: duration,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error('Cron job execution failed', {
      error: error instanceof Error ? error.message : String(error),
      duration_ms: duration,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'CRON_JOB_ERROR',
          message: 'Failed to execute cron job',
          details: error instanceof Error ? error.message : String(error),
        },
        meta: {
          timestamp: new Date().toISOString(),
          execution_time_ms: duration,
        },
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'This endpoint only accepts POST requests',
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    { status: 405 }
  );
}
