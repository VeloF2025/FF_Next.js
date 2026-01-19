/**
 * Weekly Import API - Get Import Status
 *
 * 🟢 WORKING: Production-ready endpoint for retrieving weekly import status
 *
 * GET /api/ticketing/import/weekly/[id] - Get import status and progress
 *
 * Features:
 * - Retrieve import status by ID
 * - Progress tracking information
 * - Error details for failed imports
 * - UUID validation
 * - Proper error handling with standard API responses
 * - Follows Zero Tolerance protocol (no console.log, proper error handling)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  getWeeklyReportById,
  getImportProgress,
} from '@/modules/ticketing/services/weeklyReportService';

const logger = createLogger('ticketing:api:weekly-import-status');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ==================== GET /api/ticketing/import/weekly/[id] ====================

/**
 * 🟢 WORKING: Get weekly import status and progress
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Validate UUID format
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'INVALID_ID',
            message: 'Invalid report ID format. Must be a valid UUID.',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    logger.debug('Fetching weekly report status', { reportId: id });

    // Get report
    const report = await getWeeklyReportById(id);

    if (!report) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Weekly report not found',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 404 }
      );
    }

    // Get progress information
    const progress = await getImportProgress(id);

    // Build response
    const responseData = {
      id: report.id,
      report_uid: report.report_uid,
      week_number: report.week_number,
      year: report.year,
      report_date: report.report_date,
      original_filename: report.original_filename,
      status: report.status,

      // Progress information
      total_rows: report.total_rows,
      imported_count: report.imported_count,
      skipped_count: report.skipped_count,
      error_count: report.error_count,
      progress_percentage: progress.progress_percentage,
      estimated_time_remaining_seconds: progress.estimated_time_remaining_seconds,
      current_batch: progress.current_batch,
      total_batches: progress.total_batches,

      // Error details (if any)
      errors: report.errors || [],

      // Timestamps
      created_at: report.created_at,
      imported_at: report.imported_at,
      imported_by: report.imported_by,
    };

    return NextResponse.json({
      success: true,
      data: responseData,
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Error fetching weekly import status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      reportId: params.id,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch import status',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
