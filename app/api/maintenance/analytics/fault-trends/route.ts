/**
 * Fault Trends Analytics API Route
 *
 * 🟢 WORKING: Production-ready API endpoint for fault trend analysis
 *
 * GET /api/ticketing/analytics/fault-trends - Get fault trends by cause or location
 *
 * Features:
 * - Group by: fault_cause, pole_number, pon_number, zone_id, dr_number
 * - Filter by: project_id, start_date, end_date
 * - Returns counts and percentages
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { query } from '@/modules/ticketing/utils/db';

const logger = createLogger('ticketing:api:fault-trends');

/**
 * Valid group_by parameters
 */
const VALID_GROUP_BY = [
  'fault_cause',
  'pole_number',
  'pon_number',
  'zone_id',
  'dr_number',
] as const;

type GroupByType = typeof VALID_GROUP_BY[number];

/**
 * Validate group_by parameter
 */
function isValidGroupBy(groupBy: any): groupBy is GroupByType {
  return typeof groupBy === 'string' && VALID_GROUP_BY.includes(groupBy as GroupByType);
}

/**
 * Validation error response
 */
function validationError(message: string, details?: any) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message,
        ...(details && { details }),
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    { status: 422 }
  );
}

/**
 * Database error response
 */
function databaseError(message: string) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    },
    { status: 500 }
  );
}

// ==================== GET /api/ticketing/analytics/fault-trends ====================

/**
 * GET handler - Get fault trends by cause or location
 * 🟢 WORKING: Returns aggregated fault trends with counts and percentages
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);

    // Get group_by parameter (required)
    const groupBy = searchParams.get('group_by') || 'fault_cause';

    // Validate group_by parameter
    if (!isValidGroupBy(groupBy)) {
      logger.warn('Invalid group_by parameter', { groupBy });
      return validationError(
        `Invalid group_by parameter. Must be one of: ${VALID_GROUP_BY.join(', ')}`,
        { valid_values: VALID_GROUP_BY }
      );
    }

    // Get optional filter parameters
    const projectId = searchParams.get('project_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const faultCause = searchParams.get('fault_cause');

    logger.info('Fetching fault trends', {
      groupBy,
      projectId,
      startDate,
      endDate,
      faultCause,
    });

    // Build SQL query with dynamic grouping and filtering
    const params: any[] = [];
    let paramIndex = 1;

    // Base query - group by the requested field
    let sql = `
      SELECT
        ${groupBy},
        COUNT(*)::text as count,
        ROUND((COUNT(*) * 100.0 / SUM(COUNT(*)) OVER ()), 2)::text as percentage
      FROM tickets
      WHERE 1=1
    `;

    // Add filters
    if (projectId) {
      sql += ` AND project_id = $${paramIndex}`;
      params.push(projectId);
      paramIndex++;
    }

    if (startDate) {
      sql += ` AND created_at >= $${paramIndex}::timestamp`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      sql += ` AND created_at <= $${paramIndex}::timestamp`;
      params.push(endDate);
      paramIndex++;
    }

    if (faultCause) {
      sql += ` AND fault_cause = $${paramIndex}`;
      params.push(faultCause);
      paramIndex++;
    }

    // Only include tickets where the groupBy field is not null
    // (except for fault_cause which we want to include nulls for pending classification)
    if (groupBy !== 'fault_cause') {
      sql += ` AND ${groupBy} IS NOT NULL`;
    }

    // Group by and order by count descending
    sql += `
      GROUP BY ${groupBy}
      ORDER BY COUNT(*) DESC
    `;

    logger.debug('Executing fault trends query', { sql, params });

    // Execute query
    const result = await query(sql, params);

    logger.info('Successfully fetched fault trends', {
      groupBy,
      resultCount: result.rows.length,
    });

    // Calculate total count
    const totalCount = result.rows.reduce((sum, row) => sum + parseInt(row.count), 0);

    return NextResponse.json(
      {
        success: true,
        data: result.rows,
        meta: {
          timestamp: new Date().toISOString(),
          group_by: groupBy,
          total_count: totalCount,
          result_count: result.rows.length,
          ...(projectId && { project_id: projectId }),
          ...(startDate && { start_date: startDate }),
          ...(endDate && { end_date: endDate }),
          ...(faultCause && { fault_cause: faultCause }),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error fetching fault trends', {
      error: error instanceof Error ? error.message : String(error),
    });

    return databaseError(
      process.env.NODE_ENV === 'development'
        ? `Failed to fetch fault trends: ${error instanceof Error ? error.message : String(error)}`
        : 'Failed to fetch fault trends'
    );
  }
}
