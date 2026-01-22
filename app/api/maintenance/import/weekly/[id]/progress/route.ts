/**
 * Weekly Import API - Get Import Progress
 *
 * GET /api/maintenance/import/weekly/[id]/progress - Get import progress
 *
 * Returns focused progress information for polling during import.
 * Lighter response than the full status endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  getWeeklyReportById,
  getImportProgress,
} from '@/modules/maintenance/services/weeklyReportService';

const logger = createLogger('maintenance:api:weekly-import-progress');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ==================== GET /api/maintenance/import/weekly/[id]/progress ====================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

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

    logger.debug('Fetching import progress', { reportId: id });

    // Get report for status
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

    // Return focused progress response
    return NextResponse.json({
      success: true,
      data: {
        id: report.id,
        status: report.status,
        total_rows: report.total_rows,
        imported_count: report.imported_count,
        skipped_count: report.skipped_count,
        error_count: report.error_count,
        progress_percentage: progress.progress_percentage,
        estimated_time_remaining_seconds: progress.estimated_time_remaining_seconds,
        current_batch: progress.current_batch,
        total_batches: progress.total_batches,
        errors: report.errors || [],
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    const resolvedParams = await params.catch(() => ({ id: 'unknown' }));
    logger.error('Error fetching import progress', {
      error: error instanceof Error ? error.message : 'Unknown error',
      reportId: resolvedParams.id,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to fetch import progress',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
