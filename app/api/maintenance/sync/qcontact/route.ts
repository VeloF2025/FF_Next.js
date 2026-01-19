/**
 * QContact Sync Trigger API Route
 * 🟢 WORKING: Production-ready API endpoint for triggering QContact sync
 *
 * POST /api/ticketing/sync/qcontact - Trigger full bidirectional sync
 *
 * Features:
 * - Bidirectional sync (inbound + outbound)
 * - Inbound-only sync
 * - Outbound-only sync
 * - Date range filtering
 * - Specific ticket filtering
 * - Force resync option
 * - Comprehensive sync reporting
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  runFullSync,
  runInboundOnlySync,
  runOutboundOnlySync,
} from '@/modules/ticketing/services/qcontactSyncOrchestrator';
import { SyncDirection } from '@/modules/ticketing/types/qcontact';
import type { FullSyncRequest } from '@/modules/ticketing/types/qcontact';

const logger = createLogger('ticketing:api:sync:qcontact');

// ==================== POST /api/ticketing/sync/qcontact ====================

/**
 * 🟢 WORKING: Trigger QContact sync with configurable options
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Parse and validate request
    const syncRequest: FullSyncRequest = {
      sync_direction: body.sync_direction,
      start_date: body.start_date ? new Date(body.start_date) : undefined,
      end_date: body.end_date ? new Date(body.end_date) : undefined,
      ticket_ids: body.ticket_ids,
      force_resync: body.force_resync || false,
    };

    // Validate sync_direction if provided
    if (
      syncRequest.sync_direction &&
      ![SyncDirection.INBOUND, SyncDirection.OUTBOUND].includes(
        syncRequest.sync_direction
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid sync_direction',
            details: {
              sync_direction: `Must be one of: ${SyncDirection.INBOUND}, ${SyncDirection.OUTBOUND}`,
              valid_values: [SyncDirection.INBOUND, SyncDirection.OUTBOUND],
            },
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    // Validate date range
    if (
      syncRequest.start_date &&
      syncRequest.end_date &&
      syncRequest.start_date > syncRequest.end_date
    ) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid date range',
            details: {
              date_range: 'start_date must be before end_date',
            },
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    logger.info('Starting QContact sync', {
      sync_direction: syncRequest.sync_direction || 'bidirectional',
      start_date: syncRequest.start_date,
      end_date: syncRequest.end_date,
      ticket_ids_count: syncRequest.ticket_ids?.length || 0,
      force_resync: syncRequest.force_resync,
    });

    // Execute sync based on direction
    let result;

    if (!syncRequest.sync_direction) {
      // Bidirectional sync (default)
      logger.debug('Running full bidirectional sync');
      result = await runFullSync(syncRequest);
    } else if (syncRequest.sync_direction === SyncDirection.INBOUND) {
      // Inbound-only sync
      logger.debug('Running inbound-only sync');
      result = await runInboundOnlySync(syncRequest);
    } else {
      // Outbound-only sync
      logger.debug('Running outbound-only sync');
      result = await runOutboundOnlySync(syncRequest);
    }

    logger.info('QContact sync completed', {
      duration_seconds: result.duration_seconds,
      total_success: result.total_success,
      total_failed: result.total_failed,
      success_rate: result.success_rate,
      inbound_processed: result.inbound_stats.total_processed,
      outbound_processed: result.outbound_stats.total_processed,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          sync_result: result,
          summary: {
            direction: syncRequest.sync_direction || 'bidirectional',
            duration_seconds: result.duration_seconds,
            total_success: result.total_success,
            total_failed: result.total_failed,
            success_rate: result.success_rate,
            inbound: {
              processed: result.inbound_stats.total_processed,
              successful: result.inbound_stats.successful,
              failed: result.inbound_stats.failed,
              created: result.inbound_stats.created,
              updated: result.inbound_stats.updated,
            },
            outbound: {
              processed: result.outbound_stats.total_processed,
              successful: result.outbound_stats.successful,
              failed: result.outbound_stats.failed,
            },
          },
        },
        message: 'Sync completed successfully',
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error running QContact sync', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SYNC_ERROR',
          message: 'Failed to run sync',
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
