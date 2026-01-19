/**
 * QContact Sync Log API Route
 * 🟢 WORKING: Production-ready API endpoint for retrieving sync audit logs
 *
 * GET /api/ticketing/sync/qcontact/log - Get sync audit log with filters
 *
 * Features:
 * - Filterable log retrieval (direction, type, status, date range, ticket ID)
 * - Pagination support
 * - Statistics summary (by direction, by status, success rate)
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { query } from '@/modules/ticketing/utils/db';
import { SyncDirection, SyncType, SyncStatus } from '@/modules/ticketing/types/qcontact';
import type { QContactSyncLog } from '@/modules/ticketing/types/qcontact';

const logger = createLogger('ticketing:api:sync:log');

// Valid enum values for validation
const VALID_DIRECTIONS = [SyncDirection.INBOUND, SyncDirection.OUTBOUND];
const VALID_TYPES = [
  SyncType.CREATE,
  SyncType.STATUS_UPDATE,
  SyncType.ASSIGNMENT,
  SyncType.NOTE_ADD,
  SyncType.FULL_SYNC,
];
const VALID_STATUSES = [SyncStatus.SUCCESS, SyncStatus.FAILED, SyncStatus.PARTIAL];

// ==================== GET /api/ticketing/sync/qcontact/log ====================

/**
 * 🟢 WORKING: Get sync audit log with filters and pagination
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const conditions: string[] = [];
    const values: any[] = [];
    let paramCounter = 1;

    // Filter by ticket_id
    if (searchParams.has('ticket_id')) {
      conditions.push(`ticket_id = $${paramCounter++}`);
      values.push(searchParams.get('ticket_id'));
    }

    // Filter by qcontact_ticket_id
    if (searchParams.has('qcontact_ticket_id')) {
      conditions.push(`qcontact_ticket_id = $${paramCounter++}`);
      values.push(searchParams.get('qcontact_ticket_id'));
    }

    // Filter by sync_direction (single or multiple)
    if (searchParams.has('sync_direction')) {
      const directionParam = searchParams.get('sync_direction')!;
      const directions = directionParam.split(',').map((d) => d.trim());

      // Validate directions
      const invalidDirections = directions.filter(
        (d) => !VALID_DIRECTIONS.includes(d as any)
      );
      if (invalidDirections.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid sync_direction values: ${invalidDirections.join(', ')}`,
              details: {
                valid_values: VALID_DIRECTIONS,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }

      if (directions.length === 1) {
        conditions.push(`sync_direction = $${paramCounter++}`);
        values.push(directions[0]);
      } else {
        conditions.push(`sync_direction = ANY($${paramCounter++})`);
        values.push(directions);
      }
    }

    // Filter by sync_type (single or multiple)
    if (searchParams.has('sync_type')) {
      const typeParam = searchParams.get('sync_type')!;
      const types = typeParam.split(',').map((t) => t.trim());

      // Validate types
      const invalidTypes = types.filter((t) => !VALID_TYPES.includes(t as any));
      if (invalidTypes.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid sync_type values: ${invalidTypes.join(', ')}`,
              details: {
                valid_values: VALID_TYPES,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }

      if (types.length === 1) {
        conditions.push(`sync_type = $${paramCounter++}`);
        values.push(types[0]);
      } else {
        conditions.push(`sync_type = ANY($${paramCounter++})`);
        values.push(types);
      }
    }

    // Filter by status (single or multiple)
    if (searchParams.has('status')) {
      const statusParam = searchParams.get('status')!;
      const statuses = statusParam.split(',').map((s) => s.trim());

      // Validate statuses
      const invalidStatuses = statuses.filter((s) => !VALID_STATUSES.includes(s as any));
      if (invalidStatuses.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid status values: ${invalidStatuses.join(', ')}`,
              details: {
                valid_values: VALID_STATUSES,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 422 }
        );
      }

      if (statuses.length === 1) {
        conditions.push(`status = $${paramCounter++}`);
        values.push(statuses[0]);
      } else {
        conditions.push(`status = ANY($${paramCounter++})`);
        values.push(statuses);
      }
    }

    // Filter by date range
    if (searchParams.has('synced_after')) {
      conditions.push(`synced_at >= $${paramCounter++}`);
      values.push(new Date(searchParams.get('synced_after')!));
    }

    if (searchParams.has('synced_before')) {
      conditions.push(`synced_at <= $${paramCounter++}`);
      values.push(new Date(searchParams.get('synced_before')!));
    }

    // Pagination
    const page = searchParams.has('page') ? parseInt(searchParams.get('page')!, 10) : 1;
    const pageSize = searchParams.has('pageSize')
      ? parseInt(searchParams.get('pageSize')!, 10)
      : 50;
    const offset = (page - 1) * pageSize;

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countSql = `
      SELECT COUNT(*) as total
      FROM qcontact_sync_log
      ${whereClause}
    `;

    const countResult = await query<{ total: string }>(countSql, values);
    const total = parseInt(countResult[0]?.total || '0', 10);

    // Get logs with pagination
    const logsSql = `
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
      LIMIT $${paramCounter++} OFFSET $${paramCounter++}
    `;

    const logs = await query<QContactSyncLog>(logsSql, [...values, pageSize, offset]);

    // Get statistics
    const statsSql = `
      SELECT
        sync_direction,
        status,
        COUNT(*) as count
      FROM qcontact_sync_log
      ${whereClause}
      GROUP BY sync_direction, status
    `;

    const stats = await query<{
      sync_direction: string;
      status: string;
      count: string;
    }>(statsSql, values);

    // Calculate aggregated stats
    const by_direction: Record<string, number> = {};
    const by_status: Record<string, number> = {};
    let total_successful = 0;
    let total_failed = 0;

    for (const stat of stats) {
      const count = parseInt(stat.count, 10);

      // Aggregate by direction
      by_direction[stat.sync_direction] =
        (by_direction[stat.sync_direction] || 0) + count;

      // Aggregate by status
      by_status[stat.status] = (by_status[stat.status] || 0) + count;

      // Count successful vs failed
      if (stat.status === SyncStatus.SUCCESS) {
        total_successful += count;
      } else if (stat.status === SyncStatus.FAILED) {
        total_failed += count;
      }
    }

    // Calculate success rate
    const success_rate =
      total_successful + total_failed > 0
        ? total_successful / (total_successful + total_failed)
        : 0;

    logger.debug('Sync logs retrieved', {
      total,
      page,
      pageSize,
      filters: Object.keys(conditions).length,
    });

    return NextResponse.json({
      success: true,
      data: {
        logs,
        stats: {
          by_direction,
          by_status,
          success_rate,
        },
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching sync logs', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch sync logs',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
