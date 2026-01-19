/**
 * QContact Sync Cron Job API Route
 * 🟢 WORKING: Production-ready API endpoint for cron-triggered sync
 *
 * POST /api/ticketing/cron/sync-qcontact - Trigger automatic sync job
 *
 * Features:
 * - Designed for Vercel Cron or external cron services
 * - Optional authorization header verification
 * - Automatic job execution tracking
 * - Comprehensive error handling
 * - Returns job execution status
 *
 * Deployment:
 * - Vercel Cron: Add to vercel.json
 * - External Cron: Call this endpoint on schedule
 * - Manual Trigger: POST request to this endpoint
 *
 * Security:
 * - Optionally verify CRON_SECRET environment variable
 * - Only allows POST requests
 *
 * @module api/ticketing/cron/sync-qcontact
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { runSyncJob } from '@/modules/ticketing/jobs/qcontactSync';

const logger = createLogger('ticketing:api:cron:sync-qcontact');

// ==================== POST /api/ticketing/cron/sync-qcontact ====================

/**
 * 🟢 WORKING: Trigger QContact sync job via cron
 *
 * Security:
 * - Optionally checks Authorization header against CRON_SECRET env var
 * - Returns 401 if secret is configured but doesn't match
 *
 * Returns:
 * - 200: Job executed successfully
 * - 401: Unauthorized (invalid cron secret)
 * - 500: Internal server error
 */
export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // Optional: Verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers.get('authorization');
      const providedSecret = authHeader?.replace('Bearer ', '');

      if (providedSecret !== cronSecret) {
        logger.warn('Unauthorized cron job trigger attempt', {
          provided_secret_length: providedSecret?.length || 0,
        });

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

    logger.info('Cron job triggered: QContact sync');

    // Run the sync job
    const jobResult = await runSyncJob();

    const duration = Date.now() - startTime;

    logger.info('Cron job completed', {
      job_id: jobResult.job_id,
      status: jobResult.status,
      duration_ms: duration,
      total_success: jobResult.sync_result?.total_success || 0,
      total_failed: jobResult.sync_result?.total_failed || 0,
    });

    // Return success response
    return NextResponse.json(
      {
        success: true,
        data: {
          job_id: jobResult.job_id,
          status: jobResult.status,
          started_at: jobResult.started_at,
          completed_at: jobResult.completed_at,
          duration_seconds: jobResult.duration_seconds,
          summary: jobResult.sync_result
            ? {
                total_processed:
                  jobResult.sync_result.inbound_stats.total_processed +
                  jobResult.sync_result.outbound_stats.total_processed,
                total_success: jobResult.sync_result.total_success,
                total_failed: jobResult.sync_result.total_failed,
                success_rate: jobResult.sync_result.success_rate,
                inbound: {
                  processed: jobResult.sync_result.inbound_stats.total_processed,
                  successful: jobResult.sync_result.inbound_stats.successful,
                  failed: jobResult.sync_result.inbound_stats.failed,
                  created: jobResult.sync_result.inbound_stats.created,
                  updated: jobResult.sync_result.inbound_stats.updated,
                },
                outbound: {
                  processed: jobResult.sync_result.outbound_stats.total_processed,
                  successful: jobResult.sync_result.outbound_stats.successful,
                  failed: jobResult.sync_result.outbound_stats.failed,
                },
              }
            : null,
          error_message: jobResult.error_message,
          error_code: jobResult.error_code,
        },
        message:
          jobResult.status === 'success'
            ? 'Sync job completed successfully'
            : jobResult.status === 'partial'
            ? 'Sync job completed with some failures'
            : 'Sync job failed',
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

/**
 * 🟢 WORKING: Reject non-POST requests
 */
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
