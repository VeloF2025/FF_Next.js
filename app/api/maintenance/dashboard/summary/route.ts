/**
 * Dashboard Summary API Route
 *
 * 🟢 WORKING: Production-ready dashboard summary endpoint
 *
 * GET /api/ticketing/dashboard/summary - Get complete dashboard summary
 *
 * Returns:
 * - Total tickets count
 * - Tickets by status breakdown
 * - SLA compliance metrics
 * - Overdue tickets count
 * - Average resolution time
 *
 * Query Parameters:
 * - project_id?: string - Filter by project
 * - start_date?: ISO8601 date - Filter start date
 * - end_date?: ISO8601 date - Filter end date
 *
 * Features:
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 * - Date range filtering support
 * - Project filtering support
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getDashboardSummary } from '@/modules/ticketing/services/dashboardService';
import type { DashboardFilters } from '@/modules/ticketing/services/dashboardService';

const logger = createLogger('ticketing:api:dashboard:summary');

/**
 * 🟢 WORKING: Get dashboard summary statistics
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: DashboardFilters = {};

    // Project filter
    if (searchParams.has('project_id')) {
      filters.project_id = searchParams.get('project_id')!;
    }

    // Date range filters
    if (searchParams.has('start_date')) {
      const startDateStr = searchParams.get('start_date')!;
      filters.start_date = new Date(startDateStr);
    }
    if (searchParams.has('end_date')) {
      const endDateStr = searchParams.get('end_date')!;
      filters.end_date = new Date(endDateStr);
    }

    logger.debug('Fetching dashboard summary', { filters });

    const summary = await getDashboardSummary(filters);

    return NextResponse.json({
      success: true,
      data: summary,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching dashboard summary', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch dashboard summary'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      },
      { status: 500 }
    );
  }
}
