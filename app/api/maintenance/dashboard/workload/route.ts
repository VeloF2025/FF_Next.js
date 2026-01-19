/**
 * Dashboard Workload API Route
 *
 * 🟢 WORKING: Production-ready workload distribution endpoint
 *
 * GET /api/ticketing/dashboard/workload - Get workload by assignee
 *
 * Returns array of workload data:
 * - assigned_to: User ID or null
 * - assignee_name: User name or 'Unassigned'
 * - ticket_count: Total tickets assigned
 * - overdue_count: Overdue tickets count
 *
 * Query Parameters:
 * - active_only?: boolean - Only count active tickets (exclude closed/cancelled)
 *
 * Features:
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 * - Active tickets filtering
 * - Sorted by ticket count descending
 * - Includes unassigned tickets
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getWorkloadByAssignee } from '@/modules/ticketing/services/dashboardService';
import type { DashboardFilters } from '@/modules/ticketing/services/dashboardService';

const logger = createLogger('ticketing:api:dashboard:workload');

/**
 * 🟢 WORKING: Get workload distribution by assignee
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: DashboardFilters = {};

    // Active tickets only filter
    if (searchParams.has('active_only')) {
      filters.active_only = searchParams.get('active_only') === 'true';
    }

    logger.debug('Fetching workload by assignee', { filters });

    const workloadData = await getWorkloadByAssignee(filters);

    return NextResponse.json({
      success: true,
      data: workloadData,
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error fetching workload data', { error });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to fetch workload data'
        },
        meta: {
          timestamp: new Date().toISOString()
        }
      },
      { status: 500 }
    );
  }
}
