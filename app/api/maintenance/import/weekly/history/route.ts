/**
 * Weekly Import API - Import History
 *
 * 🟢 WORKING: Production-ready endpoint for listing weekly import history
 *
 * GET /api/ticketing/import/weekly/history - List all imports with filters
 *
 * Features:
 * - List all weekly imports
 * - Filter by status, week number, year, user
 * - Summary statistics
 * - Sorted by newest first
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  listWeeklyReports,
  getWeeklyReportStats,
} from '@/modules/ticketing/services/weeklyReportService';
import { WeeklyReportStatus, WeeklyReportFilters } from '@/modules/ticketing/types/weeklyReport';

const logger = createLogger('ticketing:api:weekly-import-history');

// Valid status values for validation
const VALID_STATUSES: WeeklyReportStatus[] = [
  WeeklyReportStatus.PENDING,
  WeeklyReportStatus.PROCESSING,
  WeeklyReportStatus.COMPLETED,
  WeeklyReportStatus.FAILED,
];

// ==================== GET /api/ticketing/import/weekly/history ====================

/**
 * 🟢 WORKING: List weekly import history with filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    // Parse filters from query params
    const filters: WeeklyReportFilters = {};

    // Status filter (can be single or multiple)
    if (searchParams.has('status')) {
      const statusParam = searchParams.get('status')!;
      const statuses = statusParam.split(',').map((s) => s.trim());

      // Validate status values
      const invalidStatuses = statuses.filter((s) => !VALID_STATUSES.includes(s as WeeklyReportStatus));
      if (invalidStatuses.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid status values: ${invalidStatuses.join(', ')}`,
              details: {
                valid_statuses: VALID_STATUSES,
              },
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          },
          { status: 400 }
        );
      }

      filters.status = statuses.length === 1
        ? (statuses[0] as WeeklyReportStatus)
        : (statuses as WeeklyReportStatus[]);
    }

    // Week number filter
    if (searchParams.has('week_number')) {
      const weekNumber = parseInt(searchParams.get('week_number')!, 10);
      if (!isNaN(weekNumber) && weekNumber >= 1 && weekNumber <= 53) {
        filters.week_number = weekNumber;
      }
    }

    // Year filter
    if (searchParams.has('year')) {
      const year = parseInt(searchParams.get('year')!, 10);
      if (!isNaN(year) && year >= 2000 && year <= 2100) {
        filters.year = year;
      }
    }

    // Imported by filter
    if (searchParams.has('imported_by')) {
      filters.imported_by = searchParams.get('imported_by')!;
    }

    // Date range filters
    if (searchParams.has('imported_after')) {
      try {
        filters.imported_after = new Date(searchParams.get('imported_after')!);
      } catch (error) {
        // Invalid date format - skip filter
        logger.warn('Invalid imported_after date format', {
          value: searchParams.get('imported_after'),
        });
      }
    }

    if (searchParams.has('imported_before')) {
      try {
        filters.imported_before = new Date(searchParams.get('imported_before')!);
      } catch (error) {
        // Invalid date format - skip filter
        logger.warn('Invalid imported_before date format', {
          value: searchParams.get('imported_before'),
        });
      }
    }

    logger.debug('Fetching weekly import history', { filters });

    // Get reports
    const result = await listWeeklyReports(filters);

    // Get aggregate statistics (if no filters applied)
    let stats = null;
    if (Object.keys(filters).length === 0) {
      stats = await getWeeklyReportStats();
    }

    return NextResponse.json({
      success: true,
      data: {
        reports: result.reports,
        total: result.total,
        by_status: result.by_status,
        total_imported_tickets: result.total_imported_tickets,
        stats: stats || undefined,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching weekly import history', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch import history',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
