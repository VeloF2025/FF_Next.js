/**
 * FiberTime QContact Sync API Route
 * 🟢 WORKING: Syncs tickets from FiberTime QContact (Maintenance - Velocity)
 *
 * POST /api/ticketing/sync/fibertime - Trigger inbound sync from FiberTime
 * GET /api/ticketing/sync/fibertime - Check sync status and last run
 *
 * FiberTime QContact:
 * - Base URL: https://fibertime.qcontact.com/api/v2/
 * - Auth: Token-based (uid, access-token, client headers)
 * - Target: Cases assigned to "Maintenance - Velocity" (ID: 21924332416)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  syncFiberTimeInboundTickets,
  type FiberTimeSyncOptions,
} from '@/modules/ticketing/services/qcontactSyncInbound';
import {
  getDefaultFiberTimeQContactClient,
  MAINTENANCE_VELOCITY_ID,
} from '@/modules/ticketing/services/fibertimeQContactClient';

const logger = createLogger('ticketing:api:sync:fibertime');

// ==================== GET /api/ticketing/sync/fibertime ====================

/**
 * 🟢 WORKING: Check FiberTime sync status and API health
 */
export async function GET() {
  try {
    const client = getDefaultFiberTimeQContactClient();

    // Health check
    const isHealthy = await client.healthCheck();

    return NextResponse.json(
      {
        success: true,
        data: {
          status: isHealthy ? 'connected' : 'disconnected',
          endpoint: 'https://fibertime.qcontact.com/api/v2/',
          maintenance_velocity_id: MAINTENANCE_VELOCITY_ID,
          message: isHealthy
            ? 'FiberTime QContact API is reachable'
            : 'FiberTime QContact API is not responding',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error checking FiberTime status', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'STATUS_CHECK_ERROR',
          message: 'Failed to check FiberTime status',
          details: error instanceof Error ? error.message : String(error),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}

// ==================== POST /api/ticketing/sync/fibertime ====================

/**
 * 🟢 WORKING: Trigger FiberTime inbound sync
 */
export async function POST(req: NextRequest) {
  try {
    let body: Partial<FiberTimeSyncOptions> = {};

    try {
      body = await req.json();
    } catch {
      // Empty body is fine, use defaults
    }

    const syncOptions: FiberTimeSyncOptions = {
      assignedTo: body.assignedTo || MAINTENANCE_VELOCITY_ID,
      page: body.page || 1,
      pageSize: body.pageSize || 50,
    };

    logger.info('Starting FiberTime inbound sync', {
      assignedTo: syncOptions.assignedTo,
      page: syncOptions.page,
      pageSize: syncOptions.pageSize,
    });

    // Execute the sync
    const result = await syncFiberTimeInboundTickets(syncOptions);

    logger.info('FiberTime sync completed', {
      duration_seconds: result.duration_seconds,
      total_processed: result.total_processed,
      successful: result.successful,
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          sync_result: result,
          summary: {
            source: 'FiberTime QContact',
            target_assignee: 'Maintenance - Velocity',
            duration_seconds: result.duration_seconds,
            total_processed: result.total_processed,
            successful: result.successful,
            created: result.created,
            skipped: result.skipped,
            failed: result.failed,
            error_count: result.errors.length,
          },
        },
        message: result.failed === 0
          ? 'Sync completed successfully'
          : `Sync completed with ${result.failed} error(s)`,
        meta: {
          timestamp: new Date().toISOString(),
          started_at: result.started_at.toISOString(),
          completed_at: result.completed_at.toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error running FiberTime sync', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SYNC_ERROR',
          message: 'Failed to run FiberTime sync',
          details: error instanceof Error ? error.message : String(error),
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
