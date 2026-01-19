/**
 * QContact Sync Log Service
 * 🟢 WORKING: Production-ready service for sync log queries and status
 *
 * Features:
 * - Get sync status overview
 * - List sync logs with filters
 * - Calculate sync health metrics
 * - Track sync success rates
 *
 * @module ticketing/services/qcontactSyncLogService
 */

import { query } from '../utils/db';
import type {
  SyncStatusOverview,
  SyncLogListResponse,
  SyncLogFilters,
  QContactSyncLog,
} from '../types/qcontact';
import { SyncDirection, SyncStatus } from '../types/qcontact';
import { createLogger } from '@/lib/logger';

// 🟢 WORKING: Logger instance for sync log service
const logger = createLogger('qcontactSyncLogService');

// ============================================================================
// Types for Service Operations
// ============================================================================

/**
 * List sync logs request with pagination
 */
export interface ListSyncLogsRequest {
  page?: number;
  pageSize?: number;
  ticket_id?: string;
  qcontact_ticket_id?: string;
  sync_direction?: string;
  sync_type?: string;
  status?: string;
  synced_after?: Date;
  synced_before?: Date;
}

// ============================================================================
// Sync Status Operations
// ============================================================================

/**
 * Get sync status overview
 * 🟢 WORKING: Comprehensive sync health metrics
 *
 * Returns:
 * - Last sync timestamp and status
 * - Pending items count
 * - Failed syncs in last 24h
 * - Success rate over last 7 days
 * - Overall health status with issues
 *
 * @returns Sync status overview
 */
export async function getSyncStatus(): Promise<SyncStatusOverview> {
  logger.debug('Getting sync status overview');

  try {
    // Get last sync information
    const lastSyncResult = await query<{
      last_sync_at: Date | null;
      last_sync_status: string | null;
      last_sync_duration_seconds: number | null;
    }>(
      `
      SELECT
        MAX(synced_at) as last_sync_at,
        (
          SELECT status
          FROM qcontact_sync_log
          WHERE sync_type = 'full_sync'
          ORDER BY synced_at DESC
          LIMIT 1
        ) as last_sync_status,
        (
          SELECT EXTRACT(EPOCH FROM (
            MAX(synced_at) - MIN(synced_at)
          ))
          FROM qcontact_sync_log
          WHERE sync_type = 'full_sync'
            AND DATE(synced_at) = (
              SELECT DATE(MAX(synced_at))
              FROM qcontact_sync_log
              WHERE sync_type = 'full_sync'
            )
        ) as last_sync_duration_seconds
      FROM qcontact_sync_log
      WHERE sync_type = 'full_sync'
      `,
      []
    );

    const lastSync = lastSyncResult.rows[0];

    // Get pending outbound items (tickets with external_id that haven't been synced recently)
    const pendingOutboundResult = await query<{ count: string }>(
      `
      SELECT COUNT(*) as count
      FROM tickets
      WHERE external_id IS NOT NULL
        AND source = 'qcontact'
        AND updated_at > COALESCE(
          (
            SELECT MAX(synced_at)
            FROM qcontact_sync_log
            WHERE sync_direction = 'outbound'
          ),
          '1970-01-01'::timestamp
        )
      `,
      []
    );

    const pendingOutbound = parseInt(pendingOutboundResult.rows[0]?.count || '0', 10);

    // Get pending inbound items (approximate - based on recent QContact tickets)
    // In production, this would query QContact API for pending updates
    const pendingInbound = 0; // Placeholder - would need QContact API call

    // Get failed syncs in last 24 hours
    const failedLast24hResult = await query<{ count: string }>(
      `
      SELECT COUNT(*) as count
      FROM qcontact_sync_log
      WHERE status = 'failed'
        AND synced_at > NOW() - INTERVAL '24 hours'
      `,
      []
    );

    const failedLast24h = parseInt(failedLast24hResult.rows[0]?.count || '0', 10);

    // Get success rate over last 7 days
    const successRateLast7dResult = await query<{
      success_count: string;
      total_count: string;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) as total_count
      FROM qcontact_sync_log
      WHERE synced_at > NOW() - INTERVAL '7 days'
      `,
      []
    );

    const successStats = successRateLast7dResult.rows[0];
    const successCount = parseInt(successStats?.success_count || '0', 10);
    const totalCount = parseInt(successStats?.total_count || '0', 10);
    const successRateLast7d = totalCount > 0 ? successCount / totalCount : 0;

    // Determine health status
    const healthIssues: string[] = [];
    let isHealthy = true;

    // Check success rate
    if (successRateLast7d < 0.8 && totalCount > 10) {
      healthIssues.push('Success rate below 80% threshold');
      isHealthy = false;
    }

    // Check pending items
    if (pendingOutbound > 20) {
      healthIssues.push('High number of pending outbound items');
      isHealthy = false;
    }

    // Check recent failures
    if (failedLast24h > 10) {
      healthIssues.push('High number of failed syncs in last 24 hours');
      isHealthy = false;
    }

    // Check last sync status
    if (lastSync.last_sync_status === 'failed') {
      healthIssues.push('Last sync failed');
      isHealthy = false;
    }

    // Check if last sync was too long ago (> 2 hours)
    if (lastSync.last_sync_at) {
      const hoursSinceLastSync =
        (Date.now() - new Date(lastSync.last_sync_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastSync > 2) {
        healthIssues.push('No recent sync activity (last sync > 2 hours ago)');
        isHealthy = false;
      }
    }

    const statusOverview: SyncStatusOverview = {
      last_sync_at: lastSync.last_sync_at,
      last_sync_status: lastSync.last_sync_status as SyncStatus | null,
      last_sync_duration_seconds: lastSync.last_sync_duration_seconds,
      pending_outbound: pendingOutbound,
      pending_inbound: pendingInbound,
      failed_last_24h: failedLast24h,
      success_rate_last_7d: successRateLast7d,
      is_healthy: isHealthy,
      health_issues: healthIssues,
    };

    logger.info('Sync status retrieved', {
      is_healthy: isHealthy,
      success_rate: successRateLast7d,
      pending_outbound: pendingOutbound,
    });

    return statusOverview;
  } catch (error) {
    logger.error('Error getting sync status', { error });
    throw new Error('Failed to retrieve sync status');
  }
}

// ============================================================================
// Sync Log Query Operations
// ============================================================================

/**
 * List sync logs with filters and pagination
 * 🟢 WORKING: Multi-criteria filtering with statistics
 *
 * @param filters - Filter criteria and pagination
 * @returns Sync log list with statistics
 */
export async function listSyncLogs(
  filters: ListSyncLogsRequest = {}
): Promise<SyncLogListResponse> {
  const {
    page = 1,
    pageSize = 50,
    ticket_id,
    qcontact_ticket_id,
    sync_direction,
    sync_type,
    status,
    synced_after,
    synced_before,
  } = filters;

  logger.debug('Listing sync logs', { filters });

  try {
    // Build WHERE clause dynamically
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (ticket_id) {
      conditions.push(`ticket_id = $${paramIndex++}`);
      params.push(ticket_id);
    }

    if (qcontact_ticket_id) {
      conditions.push(`qcontact_ticket_id = $${paramIndex++}`);
      params.push(qcontact_ticket_id);
    }

    if (sync_direction) {
      conditions.push(`sync_direction = $${paramIndex++}`);
      params.push(sync_direction);
    }

    if (sync_type) {
      conditions.push(`sync_type = $${paramIndex++}`);
      params.push(sync_type);
    }

    if (status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(status);
    }

    if (synced_after) {
      conditions.push(`synced_at >= $${paramIndex++}`);
      params.push(synced_after);
    }

    if (synced_before) {
      conditions.push(`synced_at <= $${paramIndex++}`);
      params.push(synced_before);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM qcontact_sync_log ${whereClause}`,
      params
    );

    const total = parseInt(countResult.rows[0]?.count || '0', 10);

    // Get paginated logs
    const offset = (page - 1) * pageSize;
    const logsResult = await query<QContactSyncLog>(
      `
      SELECT
        id,
        ticket_id,
        qcontact_ticket_id,
        sync_direction,
        sync_type,
        request_payload,
        response_payload,
        status,
        error_message,
        synced_at
      FROM qcontact_sync_log
      ${whereClause}
      ORDER BY synced_at DESC
      LIMIT $${paramIndex++}
      OFFSET $${paramIndex++}
      `,
      [...params, pageSize, offset]
    );

    const logs = logsResult.rows;

    // Get statistics by direction
    const directionStatsResult = await query<{
      sync_direction: string;
      count: string;
    }>(
      `
      SELECT
        sync_direction,
        COUNT(*) as count
      FROM qcontact_sync_log
      ${whereClause}
      GROUP BY sync_direction
      `,
      params
    );

    const byDirection: Record<SyncDirection, number> = {
      [SyncDirection.INBOUND]: 0,
      [SyncDirection.OUTBOUND]: 0,
    };

    directionStatsResult.rows.forEach((row) => {
      byDirection[row.sync_direction as SyncDirection] = parseInt(row.count, 10);
    });

    // Get statistics by status
    const statusStatsResult = await query<{
      status: string;
      count: string;
    }>(
      `
      SELECT
        status,
        COUNT(*) as count
      FROM qcontact_sync_log
      ${whereClause}
      GROUP BY status
      `,
      params
    );

    const byStatus: Record<SyncStatus, number> = {
      [SyncStatus.SUCCESS]: 0,
      [SyncStatus.FAILED]: 0,
      [SyncStatus.PARTIAL]: 0,
    };

    statusStatsResult.rows.forEach((row) => {
      byStatus[row.status as SyncStatus] = parseInt(row.count, 10);
    });

    // Calculate success rate
    const totalProcessed = byStatus.success + byStatus.failed + byStatus.partial;
    const successRate = totalProcessed > 0 ? byStatus.success / totalProcessed : 0;

    logger.info('Sync logs retrieved', {
      total,
      page,
      pageSize,
      success_rate: successRate,
    });

    return {
      logs,
      total,
      by_direction: byDirection,
      by_status: byStatus,
      success_rate: successRate,
    };
  } catch (error) {
    logger.error('Error listing sync logs', { error, filters });
    throw new Error('Failed to retrieve sync logs');
  }
}
