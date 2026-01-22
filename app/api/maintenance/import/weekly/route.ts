/**
 * Weekly Import API - Upload Excel File
 *
 * POST /api/maintenance/import/weekly - Upload Excel file and create import
 *
 * Supports two request formats:
 * 1. JSON body: { filename, data (byte array), user_id }
 * 2. FormData: file, week_number, year, report_date, user_id
 *
 * Features:
 * - Excel file upload and parsing
 * - File validation (type, size)
 * - Auto-detects week number and year if not provided
 * - Automatic import processing
 * - Progress tracking
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import * as XLSX from 'xlsx';
import { parseExcelFile } from '@/modules/maintenance/utils/excelParser';

// Known ticket data column names for auto-detection
const TICKET_COLUMNS = [
  'dr number', 'dr_number', 'drnumber',
  'status', 'area', 'zone',
  'ft ref', 'ft_ref', 'ftref', 'reference',
  'issue', 'description', 'title',
];
import {
  createWeeklyReport,
  importTicketsFromReport,
} from '@/modules/maintenance/services/weeklyReportService';
import type { CreateWeeklyReportPayload } from '@/modules/maintenance/types/weeklyReport';

const logger = createLogger('maintenance:api:weekly-import');

// Configuration
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const VALID_FILE_EXTENSIONS = ['.xlsx', '.xls'];

/**
 * Get ISO week number from date
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// ==================== POST /api/maintenance/import/weekly ====================

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    let filename: string | null = null;
    let buffer: Buffer | null = null;
    let weekNumber: number | null = null;
    let year: number | null = null;
    let reportDate: Date | null = null;
    let userId: string | null = null;

    // Handle JSON body (from wizard)
    if (contentType.includes('application/json')) {
      const body = await req.json();
      filename = body.filename;
      userId = body.user_id;

      if (body.data && Array.isArray(body.data)) {
        buffer = Buffer.from(body.data);
      }

      // Auto-detect week/year from current date
      const now = new Date();
      weekNumber = body.week_number || getWeekNumber(now);
      year = body.year || now.getFullYear();
      reportDate = body.report_date ? new Date(body.report_date) : now;
    }
    // Handle FormData (traditional upload)
    else {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (file) {
        filename = file.name;
        const arrayBuffer = await file.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      const weekNumStr = formData.get('week_number') as string | null;
      const yearStr = formData.get('year') as string | null;
      const reportDateStr = formData.get('report_date') as string | null;
      userId = formData.get('user_id') as string | null;

      // Parse or auto-detect
      const now = new Date();
      weekNumber = weekNumStr ? parseInt(weekNumStr, 10) : getWeekNumber(now);
      year = yearStr ? parseInt(yearStr, 10) : now.getFullYear();
      reportDate = reportDateStr ? new Date(reportDateStr) : now;
    }

    // Validate required fields
    const errors: Record<string, string> = {};

    if (!filename || !buffer) {
      errors.file = 'File is required';
    }

    if (!weekNumber || weekNumber < 1 || weekNumber > 53) {
      errors.week_number = 'Week number must be between 1 and 53';
    }

    if (!year || year < 2000 || year > 2100) {
      errors.year = 'Year must be between 2000 and 2100';
    }

    if (!userId) {
      errors.user_id = 'User ID is required';
    }

    // Validate file if provided
    if (filename) {
      const hasValidExtension = VALID_FILE_EXTENSIONS.some((ext) =>
        filename.toLowerCase().endsWith(ext)
      );

      if (!hasValidExtension) {
        errors.file = `Only Excel files (${VALID_FILE_EXTENSIONS.join(', ')}) are allowed`;
      }
    }

    if (buffer && buffer.length > MAX_FILE_SIZE_BYTES) {
      errors.file = `File size must not exceed ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`;
    }

    // If validation errors, return 422
    if (Object.keys(errors).length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            details: errors,
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 422 }
      );
    }

    logger.info('Processing weekly report upload', {
      filename,
      weekNumber,
      year,
      userId,
    });

    // Auto-detect best sheet (same logic as parse endpoint)
    let sheetName: string | undefined;
    const workbook = XLSX.read(buffer!, { type: 'buffer' });

    const scoredSheets = workbook.SheetNames.map((name) => {
      const sheet = workbook.Sheets[name];
      const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
      const rows = range ? range.e.r - range.s.r + 1 : 0;

      // Get headers from first row
      const firstRow = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[]) || [];
      const headerLower = firstRow.map((h) => String(h || '').toLowerCase());

      // Check if any ticket columns exist
      const hasTicketColumns = TICKET_COLUMNS.some((col) =>
        headerLower.some((h) => h.includes(col))
      );

      // Score: prefer "ticket"/"mnt" in name, then by row count
      let score = rows;
      const nameLower = name.toLowerCase();
      if (nameLower.includes('ticket')) score += 10000;
      if (nameLower.includes('mnt')) score += 5000;
      if (nameLower.includes('maintenance')) score += 5000;
      if (hasTicketColumns) score += 1000;
      if (nameLower.includes('pivot') || nameLower.includes('summary')) score -= 5000;

      return { name, rows, score };
    });

    sheetName = scoredSheets.sort((a, b) => b.score - a.score)[0]?.name;

    logger.info('Auto-detected sheet', {
      selectedSheet: sheetName,
      sheets: scoredSheets.map((s) => `${s.name} (${s.rows} rows, score: ${s.score})`),
    });

    // Parse Excel file with detected sheet
    const parseResult = await parseExcelFile(buffer!, {
      hasHeaders: true,
      skipEmptyRows: true,
      trimWhitespace: true,
      sheetName,
    });

    if (!parseResult.success || parseResult.errors.length > 0) {
      logger.error('Excel parsing failed', {
        errors: parseResult.errors,
        filename,
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'PARSE_ERROR',
            message: 'Failed to parse Excel file',
            details: { errors: parseResult.errors },
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    if (parseResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: 'EMPTY_FILE',
            message: 'Excel file contains no data rows',
          },
          meta: {
            timestamp: new Date().toISOString(),
          },
        },
        { status: 400 }
      );
    }

    // Create weekly report record
    const reportPayload: CreateWeeklyReportPayload = {
      week_number: weekNumber!,
      year: year!,
      report_date: reportDate!,
      original_filename: filename!,
      file_path: `/uploads/weekly/${filename}`,
      imported_by: userId!,
    };

    const report = await createWeeklyReport(reportPayload);

    logger.info('Weekly report created', {
      reportId: report.id,
      reportUID: report.report_uid,
      totalRows: parseResult.rows.length,
    });

    // Start import process asynchronously
    // Note: In production, this should be a background job/queue
    importTicketsFromReport(report.id, parseResult.rows, userId!)
      .then((result) => {
        logger.info('Import completed', {
          reportId: report.id,
          imported: result.imported_count,
          skipped: result.skipped_count,
          errors: result.error_count,
        });
      })
      .catch((error) => {
        logger.error('Import failed', {
          reportId: report.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

    // Return report immediately with PENDING status
    // Note: Frontend expects 'id' field (WeeklyReport type), not 'report_id'
    return NextResponse.json(
      {
        success: true,
        data: {
          id: report.id,
          report_id: report.id, // Keep for backwards compatibility
          report_uid: report.report_uid,
          status: report.status,
          total_rows: parseResult.rows.length,
          message: 'Import started successfully',
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error('Error processing weekly import', {
      error: errorMessage,
      stack: errorStack,
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to process weekly import',
          details: errorMessage, // Include error details for debugging
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      },
      { status: 500 }
    );
  }
}
