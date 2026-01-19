/**
 * QContact Sync Background Job
 * 🟢 WORKING: Production-ready background job for automatic periodic sync
 *
 * Features:
 * - Automatic periodic sync execution
 * - Job execution tracking in database
 * - Comprehensive error handling
 * - Status tracking (success, failed, partial)
 * - Execution history retrieval
 * - Supports custom sync options
 *
 * Usage:
 * - Can be triggered by Vercel Cron, external cron services, or manual API calls
 * - Logs all executions to sync_job_history table
 * - Provides job history and status queries
 *
 * @module ticketing/jobs/qcontactSync
 */

import { query, queryOne } from '../utils/db';
import {
  runFullSync,
  runInboundOnlySync,
  runOutboundOnlySync,
} from '../services/qcontactSyncOrchestrator';
import type {
  FullSyncRequest,
  FullSyncResult,
  SyncDirection,
} from '../types/qcontact';
import { createLogger } from '@/lib/logger';

// 🟢 WORKING: Logger instance for sync job operations
const logger = createLogger('qcontactSyncJob');

// ============================================================================
// Types
// ============================================================================

/**
 * Sync job execution result
 */
export interface SyncJobResult {
  job_id: string;
  started_at: Date;
  completed_at: Date | null;
  duration_seconds: number;
  status: 'success' | 'failed' | 'partial' | 'running';
  sync_result: FullSyncResult | null;
  error_message?: string;
  error_code?: string;
}

/**
 * Sync job history entry
 */
export interface SyncJobHistoryEntry {
  id: string;
  started_at: Date;
  completed_at: Date | null;
  duration_seconds: number | null;
  status: 'success' | 'failed' | 'partial' | 'running';
  total_processed: number;
  total_success: number;
  total_failed: number;
  success_rate: number | null;
  inbound_processed: number;
  inbound_success: number;
  inbound_failed: number;
  outbound_processed: number;
  outbound_success: number;
  outbound_failed: number;
  error_message: string | null;
  error_code: string | null;
  created_at: Date;
}

/**
 * Options for querying job history
 */
export interface SyncJobHistoryOptions {
  limit?: number;
  status?: 'success' | 'failed' | 'partial' | 'running';
  start_date?: Date;
  end_date?: Date;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine job status based on sync result
 * 🟢 WORKING: Status determination logic
 *
 * @param result - Full sync result
 * @returns Job status
 */
function determineJobStatus(
  result: FullSyncResult
): 'success' | 'failed' | 'partial' {
  // If there were any failures, it's either partial or failed
  if (result.total_failed > 0) {
    // If there were also successes, it's partial
    if (result.total_success > 0) {
      return 'partial';
    }
    // If only failures, it's failed
    return 'failed';
  }

  // If no failures and no successes (nothing processed), still success
  return 'success';
}

/**
 * Create job history record in database
 * 🟢 WORKING: Inserts job execution record
 *
 * @param started_at - Job start time
 * @param completed_at - Job completion time
 * @param status - Job status
 * @param sync_result - Sync result (null if job failed)
 * @param sync_options - Sync options used
 * @param error_message - Error message if failed
 * @param error_code - Error code if failed
 * @returns Job ID
 */
async function createJobHistoryRecord(
  started_at: Date,
  completed_at: Date | null,
  status: 'success' | 'failed' | 'partial' | 'running',
  sync_result: FullSyncResult | null,
  sync_options: FullSyncRequest,
  error_message?: string,
  error_code?: string
): Promise<string> {
  const duration_seconds = completed_at
    ? (completed_at.getTime() - started_at.getTime()) / 1000
    : null;

  const sql = `
    INSERT INTO sync_job_history (
      started_at,
      completed_at,
      duration_seconds,
      status,
      total_processed,
      total_success,
      total_failed,
      success_rate,
      inbound_processed,
      inbound_success,
      inbound_failed,
      outbound_processed,
      outbound_success,
      outbound_failed,
      error_message,
      error_code,
      sync_options,
      sync_result
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
    )
    RETURNING id
  `;

  const values = [
    started_at,
    completed_at,
    duration_seconds,
    status,
    sync_result
      ? sync_result.inbound_stats.total_processed +
        sync_result.outbound_stats.total_processed
      : 0,
    sync_result ? sync_result.total_success : 0,
    sync_result ? sync_result.total_failed : 0,
    sync_result ? sync_result.success_rate : null,
    sync_result ? sync_result.inbound_stats.total_processed : 0,
    sync_result ? sync_result.inbound_stats.successful : 0,
    sync_result ? sync_result.inbound_stats.failed : 0,
    sync_result ? sync_result.outbound_stats.total_processed : 0,
    sync_result ? sync_result.outbound_stats.successful : 0,
    sync_result ? sync_result.outbound_stats.failed : 0,
    error_message || null,
    error_code || null,
    JSON.stringify(sync_options),
    sync_result ? JSON.stringify(sync_result) : null,
  ];

  try {
    const result = await query<{ id: string }>(sql, values);
    const job_id = result.rows[0]?.id;

    if (!job_id) {
      throw new Error('Failed to create job history record');
    }

    logger.debug('Created job history record', { job_id, status });

    return job_id;
  } catch (error) {
    logger.error('Failed to create job history record', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ============================================================================
// Main Job Functions
// ============================================================================

/**
 * Run QContact sync job
 * 🟢 WORKING: Executes full sync and tracks execution
 *
 * Process:
 * 1. Start job execution tracking
 * 2. Run full sync (or custom sync based on options)
 * 3. Determine job status based on result
 * 4. Log execution to database
 * 5. Return job result
 *
 * Error Handling:
 * - Catches all errors and logs them
 * - Creates failed job record on error
 * - Returns error details in result
 *
 * @param options - Custom sync options (optional)
 * @returns Job execution result
 */
export async function runSyncJob(
  options: FullSyncRequest = {}
): Promise<SyncJobResult> {
  const started_at = new Date();

  logger.info('Starting QContact sync job', {
    sync_options: options,
  });

  try {
    // Run full sync
    const sync_result = await runFullSync(options);

    const completed_at = new Date();
    const duration_seconds = (completed_at.getTime() - started_at.getTime()) / 1000;

    // Determine job status
    const status = determineJobStatus(sync_result);

    logger.info('Sync job completed', {
      status,
      duration_seconds,
      total_success: sync_result.total_success,
      total_failed: sync_result.total_failed,
      success_rate: sync_result.success_rate,
    });

    // Create job history record
    const job_id = await createJobHistoryRecord(
      started_at,
      completed_at,
      status,
      sync_result,
      options
    );

    return {
      job_id,
      started_at,
      completed_at,
      duration_seconds,
      status,
      sync_result,
    };
  } catch (error) {
    const completed_at = new Date();
    const duration_seconds = (completed_at.getTime() - started_at.getTime()) / 1000;
    const error_message = error instanceof Error ? error.message : String(error);
    const error_code = 'SYNC_JOB_ERROR';

    logger.error('Sync job failed', {
      error: error_message,
      duration_seconds,
    });

    // Create failed job record
    const job_id = await createJobHistoryRecord(
      started_at,
      completed_at,
      'failed',
      null,
      options,
      error_message,
      error_code
    );

    return {
      job_id,
      started_at,
      completed_at,
      duration_seconds,
      status: 'failed',
      sync_result: null,
      error_message,
      error_code,
    };
  }
}

/**
 * Get sync job execution history
 * 🟢 WORKING: Retrieves past job executions with filtering
 *
 * @param options - Query options (limit, status, date range)
 * @returns Array of job history entries
 */
export async function getSyncJobHistory(
  options: SyncJobHistoryOptions = {}
): Promise<SyncJobHistoryEntry[]> {
  const { limit = 50, status, start_date, end_date } = options;

  logger.debug('Fetching sync job history', options);

  const conditions: string[] = [];
  const values: any[] = [];
  let paramCounter = 1;

  // Filter by status
  if (status) {
    conditions.push(`status = $${paramCounter++}`);
    values.push(status);
  }

  // Filter by date range
  if (start_date) {
    conditions.push(`started_at >= $${paramCounter++}`);
    values.push(start_date);
  }

  if (end_date) {
    conditions.push(`started_at <= $${paramCounter++}`);
    values.push(end_date);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      id,
      started_at,
      completed_at,
      duration_seconds,
      status,
      total_processed,
      total_success,
      total_failed,
      success_rate,
      inbound_processed,
      inbound_success,
      inbound_failed,
      outbound_processed,
      outbound_success,
      outbound_failed,
      error_message,
      error_code,
      created_at
    FROM sync_job_history
    ${whereClause}
    ORDER BY started_at DESC
    LIMIT $${paramCounter}
  `;

  values.push(limit);

  try {
    const result = await query<SyncJobHistoryEntry>(sql, values);

    logger.debug('Retrieved sync job history', {
      count: result.rows.length,
    });

    return result.rows;
  } catch (error) {
    logger.error('Failed to fetch sync job history', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Get the most recent sync job execution
 * 🟢 WORKING: Retrieves last job run details
 *
 * @returns Last job history entry or null if no history exists
 */
export async function getLastSyncJobRun(): Promise<SyncJobHistoryEntry | null> {
  logger.debug('Fetching last sync job run');

  const sql = `
    SELECT
      id,
      started_at,
      completed_at,
      duration_seconds,
      status,
      total_processed,
      total_success,
      total_failed,
      success_rate,
      inbound_processed,
      inbound_success,
      inbound_failed,
      outbound_processed,
      outbound_success,
      outbound_failed,
      error_message,
      error_code,
      created_at
    FROM sync_job_history
    ORDER BY started_at DESC
    LIMIT 1
  `;

  try {
    const result = await queryOne<SyncJobHistoryEntry>(sql, []);

    if (result) {
      logger.debug('Retrieved last sync job run', {
        job_id: result.id,
        status: result.status,
        started_at: result.started_at,
      });
    } else {
      logger.debug('No sync job history found');
    }

    return result;
  } catch (error) {
    logger.error('Failed to fetch last sync job run', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
