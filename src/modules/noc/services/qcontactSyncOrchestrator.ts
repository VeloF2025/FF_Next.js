/**
 * QContact Sync Orchestrator
 * 🟢 WORKING: Production-ready service for orchestrating QContact sync
 *
 * Features:
 * - Bidirectional sync (QContact <-> FibreFlow)
 * - Inbound: QContact -> FibreFlow (with status precedence protection)
 * - Outbound: FibreFlow -> QContact (status updates via PATCH)
 * - Progress tracking
 * - Success rate calculation
 * - Comprehensive error handling
 * - Sync report generation
 *
 * @module maintenance/services/qcontactSyncOrchestrator
 */

import { query, queryOne } from '../utils/db';
import { syncFiberTimeInboundTickets } from './qcontactSyncInbound';
import { pushStatusUpdate } from './qcontactSyncOutbound';
import { TicketStatus } from '../types/ticket';

import type {
  FullSyncRequest,
  FullSyncResult,
  SyncStats,
  SyncError,
} from '../types/qcontact';
import { SyncDirection, SyncType, SyncStatus } from '../types/qcontact';
import { createLogger } from '@/lib/logger';

// 🟢 WORKING: Logger instance for orchestrator operations
const logger = createLogger('qcontactSyncOrchestrator');

// ============================================================================
// Types
// ============================================================================

/**
 * Sync progress information
 */
export interface SyncProgress {
  total: number;
  successful: number;
  failed: number;
  partial: number;
  success_rate: number;
}

/**
 * Ticket data for outbound sync
 */
interface OutboundTicket {
  id: string;
  external_id: string;
  status: string;
  assigned_to: string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate sync success rate
 * 🟢 WORKING: Success rate calculation with division by zero handling
 *
 * @param successful - Number of successful operations
 * @param failed - Number of failed operations
 * @returns Success rate as decimal (0.0 to 1.0)
 */
export function calculateSyncSuccessRate(
  successful: number,
  failed: number
): number {
  const total = successful + failed;

  if (total === 0) {
    return 0;
  }

  return successful / total;
}

/**
 * Initialize empty sync stats
 * 🟢 WORKING: Creates zero-initialized stats object
 */
function createEmptyStats(): SyncStats {
  return {
    total_processed: 0,
    successful: 0,
    failed: 0,
    partial: 0,
    skipped: 0,
    created: 0,
    updated: 0,
  };
}

/**
 * Log sync summary to qcontact_sync_log table
 * 🟢 WORKING: Creates a summary log entry for the sync operation
 */
async function logSyncSummary(
  direction: SyncDirection,
  status: SyncStatus,
  result: FullSyncResult,
  errorMessage: string | null = null
): Promise<void> {
  try {
    const sql = `
      INSERT INTO maintenance_qcontact_sync_log (
        ticket_id,
        qcontact_ticket_id,
        sync_direction,
        sync_type,
        request_payload,
        response_payload,
        status,
        error_message
      ) VALUES (
        NULL,
        NULL,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6
      )
    `;

    const requestPayload = {
      started_at: result.started_at,
      direction,
    };

    const responsePayload = {
      completed_at: result.completed_at,
      duration_seconds: result.duration_seconds,
      inbound_stats: result.inbound_stats,
      outbound_stats: result.outbound_stats,
      total_success: result.total_success,
      total_failed: result.total_failed,
      success_rate: result.success_rate,
    };

    await query(sql, [
      direction,
      SyncType.FULL_SYNC,
      JSON.stringify(requestPayload),
      JSON.stringify(responsePayload),
      status,
      errorMessage,
    ]);

    logger.debug('Sync summary logged', { direction, status });
  } catch (error) {
    logger.error('Failed to log sync summary', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Don't throw - logging failure shouldn't stop the sync result
  }
}

/**
 * Fetch tickets that need outbound sync
 * 🟢 WORKING: Retrieves tickets with QContact external_id for outbound sync
 *
 * @param options - Filter options (start_date, end_date, ticket_ids)
 * @returns Array of tickets to sync
 */
async function fetchTicketsForOutboundSync(
  options: FullSyncRequest
): Promise<OutboundTicket[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramCounter = 1;

  // Only sync tickets that came from QContact (have external_id)
  conditions.push(`external_id IS NOT NULL`);
  conditions.push(`source = 'qcontact'`);

  // Filter by update date if provided
  if (options.start_date) {
    conditions.push(`updated_at >= $${paramCounter++}`);
    values.push(options.start_date);
  }

  if (options.end_date) {
    conditions.push(`updated_at <= $${paramCounter++}`);
    values.push(options.end_date);
  }

  // Filter by specific ticket IDs if provided
  if (options.ticket_ids && options.ticket_ids.length > 0) {
    conditions.push(`id = ANY($${paramCounter++})`);
    values.push(options.ticket_ids);
  }

  const sql = `
    SELECT
      id,
      external_id,
      status,
      assigned_to
    FROM maintenance_tickets
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT 1000
  `;

  try {
    const result = await query<OutboundTicket>(sql, values);
    return result; // query returns T[] directly
  } catch (error) {
    logger.error('Failed to fetch tickets for outbound sync', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Process outbound sync for tickets
 * 🟢 WORKING: Pushes FibreFlow status updates to QContact
 *
 * @param tickets - Tickets to sync outbound
 * @returns Sync stats and errors
 */
async function processOutboundSync(
  tickets: OutboundTicket[]
): Promise<{ stats: SyncStats; errors: SyncError[] }> {
  const stats = createEmptyStats();
  const errors: SyncError[] = [];

  logger.info('Processing outbound sync', {
    ticketCount: tickets.length,
  });

  // Terminal statuses that QC won't allow changes on (already Closed)
  const TERMINAL_FF_STATUSES = ['resolved', 'closed', 'cancelled'];

  for (const ticket of tickets) {
    stats.total_processed++;

    // Skip tickets in terminal status - QC already has them as Closed
    // and returns 422 "can't re-open a Closed case"
    if (TERMINAL_FF_STATUSES.includes(ticket.status)) {
      stats.skipped++;
      continue;
    }

    try {
      const result = await pushStatusUpdate(
        ticket.id,
        ticket.status as TicketStatus
      );

      if (result.success) {
        stats.successful++;
        stats.updated++;
      } else {
        stats.failed++;
        errors.push({
          ticket_id: ticket.id,
          qcontact_ticket_id: ticket.external_id,
          sync_type: SyncType.STATUS_UPDATE,
          error_message: result.error_message || 'Unknown error',
          error_code: null,
          timestamp: new Date(),
          recoverable: true,
        });
      }
    } catch (error) {
      stats.failed++;
      errors.push({
        ticket_id: ticket.id,
        qcontact_ticket_id: ticket.external_id,
        sync_type: SyncType.STATUS_UPDATE,
        error_message: error instanceof Error ? error.message : String(error),
        error_code: null,
        timestamp: new Date(),
        recoverable: true,
      });
    }
  }

  logger.info('Outbound sync completed', {
    processed: stats.total_processed,
    successful: stats.successful,
    failed: stats.failed,
  });

  return { stats, errors };
}

// ============================================================================
// Main Sync Functions
// ============================================================================

/**
 * Run full bidirectional sync
 * 🟢 WORKING: Orchestrates sync between QContact and FibreFlow
 *
 * Process:
 * 1. Run inbound sync (QContact -> FibreFlow) with status precedence
 * 2. Run outbound sync (FibreFlow -> QContact) pushing status updates
 * 3. Generate comprehensive report
 * 4. Calculate success rate
 *
 * @param request - Sync request options
 * @returns Full sync result with stats and errors
 */
export async function runFullSync(
  request: FullSyncRequest
): Promise<FullSyncResult> {
  const started_at = new Date();

  logger.info('Starting bidirectional sync', { data: request });


  try {
    // Run inbound sync (FiberTime QContact -> FibreFlow)
    logger.info('Running inbound sync from FiberTime QContact');
    const inboundResult = await syncFiberTimeInboundTickets({
      fetchDetails: true,
    });

    logger.info('Inbound sync completed', {
      processed: inboundResult.total_processed,
      successful: inboundResult.successful,
      failed: inboundResult.failed,
    });

    // Run outbound sync (FibreFlow -> QContact)
    logger.info('Running outbound sync to QContact');
    const outboundTickets = await fetchTicketsForOutboundSync(request);
    const { stats: outboundStats, errors: outboundErrors } = await processOutboundSync(outboundTickets);

    logger.info('Outbound sync completed', {
      processed: outboundStats.total_processed,
      successful: outboundStats.successful,
      failed: outboundStats.failed,
    });

    const completed_at = new Date();
    const duration_seconds =
      (completed_at.getTime() - started_at.getTime()) / 1000;

    const totalSuccess = inboundResult.successful + outboundStats.successful;
    const totalFailed = inboundResult.failed + outboundStats.failed;
    const success_rate = calculateSyncSuccessRate(totalSuccess, totalFailed);

    const result: FullSyncResult = {
      started_at,
      completed_at,
      duration_seconds,
      inbound_stats: {
        total_processed: inboundResult.total_processed,
        successful: inboundResult.successful,
        failed: inboundResult.failed,
        partial: 0,
        skipped: inboundResult.skipped,
        created: inboundResult.created,
        updated: inboundResult.updated,
      },
      outbound_stats: outboundStats,
      total_success: totalSuccess,
      total_failed: totalFailed,
      success_rate,
      errors: [...inboundResult.errors, ...outboundErrors],
    };

    logger.info('Sync completed successfully', {
      duration_seconds: result.duration_seconds,
      total_success: result.total_success,
      total_failed: result.total_failed,
      success_rate: result.success_rate,
    });

    // Log sync summary to database
    const syncStatus = result.total_failed > 0
      ? (result.total_success > 0 ? SyncStatus.PARTIAL : SyncStatus.FAILED)
      : SyncStatus.SUCCESS;
    await logSyncSummary(SyncDirection.INBOUND, syncStatus, result);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Sync failed', {
      error: errorMessage,
      duration_seconds: (Date.now() - started_at.getTime()) / 1000,
    });

    throw error;
  }
}

/**
 * Run inbound-only sync
 * 🟢 WORKING: Syncs tickets from QContact to FibreFlow only
 *
 * @param request - Sync request options
 * @returns Full sync result with only inbound stats
 */
export async function runInboundOnlySync(
  request: FullSyncRequest
): Promise<FullSyncResult> {
  const started_at = new Date();

  logger.info('Starting inbound-only sync', { data: request });


  try {
    // Run inbound sync from FiberTime QContact
    const inboundResult = await syncFiberTimeInboundTickets({
      fetchDetails: true,
    });

    const completed_at = new Date();
    const duration_seconds =
      (completed_at.getTime() - started_at.getTime()) / 1000;

    const success_rate = calculateSyncSuccessRate(
      inboundResult.successful,
      inboundResult.failed
    );

    const result: FullSyncResult = {
      started_at,
      completed_at,
      duration_seconds,
      inbound_stats: {
        total_processed: inboundResult.total_processed,
        successful: inboundResult.successful,
        failed: inboundResult.failed,
        partial: 0,
        skipped: inboundResult.skipped,
        created: inboundResult.created,
        updated: inboundResult.updated,
      },
      outbound_stats: createEmptyStats(),
      total_success: inboundResult.successful,
      total_failed: inboundResult.failed,
      success_rate,
      errors: inboundResult.errors,
    };

    logger.info('Inbound-only sync completed', {
      duration_seconds: result.duration_seconds,
      total_success: result.total_success,
      total_failed: result.total_failed,
      success_rate: result.success_rate,
    });

    // Log sync summary to database
    const syncStatus = result.total_failed > 0
      ? (result.total_success > 0 ? SyncStatus.PARTIAL : SyncStatus.FAILED)
      : SyncStatus.SUCCESS;
    await logSyncSummary(SyncDirection.INBOUND, syncStatus, result);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Inbound-only sync failed', {
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Run outbound-only sync
 * 🟢 WORKING: Pushes FibreFlow status updates to QContact
 *
 * @param request - Sync request options
 * @returns Sync result with outbound stats
 */
export async function runOutboundOnlySync(
  request: FullSyncRequest
): Promise<FullSyncResult> {
  const started_at = new Date();

  logger.info('Starting outbound-only sync', { data: request });


  try {
    const outboundTickets = await fetchTicketsForOutboundSync(request);
    const { stats: outboundStats, errors: outboundErrors } = await processOutboundSync(outboundTickets);

    const completed_at = new Date();
    const duration_seconds =
      (completed_at.getTime() - started_at.getTime()) / 1000;

    const success_rate = calculateSyncSuccessRate(
      outboundStats.successful,
      outboundStats.failed
    );

    const result: FullSyncResult = {
      started_at,
      completed_at,
      duration_seconds,
      inbound_stats: createEmptyStats(),
      outbound_stats: outboundStats,
      total_success: outboundStats.successful,
      total_failed: outboundStats.failed,
      success_rate,
      errors: outboundErrors,
    };

    logger.info('Outbound-only sync completed', {
      duration_seconds: result.duration_seconds,
      total_success: result.total_success,
      total_failed: result.total_failed,
      success_rate: result.success_rate,
    });

    // Log sync summary
    const syncStatus = result.total_failed > 0
      ? (result.total_success > 0 ? SyncStatus.PARTIAL : SyncStatus.FAILED)
      : SyncStatus.SUCCESS;
    await logSyncSummary(SyncDirection.OUTBOUND, syncStatus, result);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('Outbound-only sync failed', {
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Get sync progress statistics
 * 🟢 WORKING: Retrieves current sync progress from database
 *
 * @returns Sync progress stats with success rate
 */
export async function getSyncProgress(): Promise<SyncProgress> {
  logger.debug('Fetching sync progress');

  // Note: synced_at is TIMESTAMP WITHOUT TIME ZONE, so cast NOW() to match
  const sql = `
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'success') as successful,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      COUNT(*) FILTER (WHERE status = 'partial') as partial
    FROM maintenance_qcontact_sync_log
    WHERE synced_at >= (NOW() AT TIME ZONE 'UTC')::timestamp - INTERVAL '24 hours'
  `;

  try {
    const result = await queryOne<{
      total: string;
      successful: string;
      failed: string;
      partial: string;
    }>(sql, []);

    const total = parseInt(result?.total || '0', 10);
    const successful = parseInt(result?.successful || '0', 10);
    const failed = parseInt(result?.failed || '0', 10);
    const partial = parseInt(result?.partial || '0', 10);

    const success_rate = calculateSyncSuccessRate(successful, failed);

    const progress: SyncProgress = {
      total,
      successful,
      failed,
      partial,
      success_rate,
    };

    logger.debug('Sync progress retrieved', { data: progress });


    return progress;
  } catch (error) {
    logger.error('Failed to fetch sync progress', {
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
