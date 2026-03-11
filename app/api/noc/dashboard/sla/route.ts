/**
 * Dashboard SLA API Route
 *
 * 🟢 WORKING: Production-ready SLA compliance endpoint
 *
 * GET /api/noc/dashboard/sla - Get SLA compliance statistics
 *
 * Returns:
 * - Total tickets
 * - SLA met count
 * - SLA breached count
 * - Compliance rate (0-100)
 * - Compliance percentage (formatted string)
 *
 * Query Parameters:
 * - start_date?: ISO8601 date - Filter start date
 * - end_date?: ISO8601 date - Filter end date
 *
 * Features:
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 * - Date range filtering support
 * - Handles zero-division gracefully
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getSLACompliance } from '@/modules/noc/services/dashboardService';
import type { DashboardFilters } from '@/modules/noc/services/dashboardService';

const logger = createLogger('maintenance:api:dashboard:sla');

/**
 * 🟢 WORKING: Get SLA compliance statistics
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: DashboardFilters = {};

    // Date range filters
    if (searchParams.has('start_date')) {
      const startDateStr = searchParams.get('start_date')!;
      filters.start_date = new Date(startDateStr);
    }
    if (searchParams.has('end_date')) {
      const endDateStr = searchParams.get('end_date')!;
      filters.end_date = new Date(endDateStr);
    }

    logger.debug('Fetching SLA compliance statistics', { filters });

    const slaData = await getSLACompliance(filters);

    return NextResponse.json({
      success: true,
      data: slaData,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching SLA compliance', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch SLA compliance'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      },
      { status: 500 }
    );
  }
}
