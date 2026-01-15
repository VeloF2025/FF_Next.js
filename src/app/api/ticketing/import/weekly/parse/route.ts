/**
 * Weekly Import Parse API - Preview Excel File
 *
 * POST /api/ticketing/import/weekly/parse - Parse Excel file and return preview
 *
 * Accepts JSON body with:
 * - filename: string - Original filename
 * - data: number[] - File data as byte array
 *
 * Returns preview data for user confirmation before import.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import {
  parseExcelFile,
  generatePreview,
  createDefaultColumnMapping,
} from '@/modules/ticketing/utils/excelParser';

const logger = createLogger('ticketing:api:weekly-import:parse');

// Configuration
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const VALID_FILE_EXTENSIONS = ['.xlsx', '.xls'];

export async function POST(req: NextRequest) {
  try {
    // Parse JSON body
    const body = await req.json();
    const { filename, data } = body;

    // Validate required fields
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'Filename is required',
        },
        { status: 400 }
      );
    }

    if (!data || !Array.isArray(data)) {
      return NextResponse.json(
        {
          success: false,
          error: 'File data is required',
        },
        { status: 400 }
      );
    }

    // Validate file extension
    const hasValidExtension = VALID_FILE_EXTENSIONS.some((ext) =>
      filename.toLowerCase().endsWith(ext)
    );

    if (!hasValidExtension) {
      return NextResponse.json(
        {
          success: false,
          error: `Only Excel files (${VALID_FILE_EXTENSIONS.join(', ')}) are allowed`,
        },
        { status: 400 }
      );
    }

    // Check file size
    if (data.length > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `File size must not exceed ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
        },
        { status: 400 }
      );
    }

    logger.info('Parsing Excel file for preview', {
      filename,
      dataLength: data.length,
    });

    // Convert byte array to Buffer
    const buffer = Buffer.from(data);

    // Parse Excel file
    const parseResult = await parseExcelFile(buffer, {
      hasHeaders: true,
      skipEmptyRows: true,
      trimWhitespace: true,
    });

    if (!parseResult.success || parseResult.errors.length > 0) {
      logger.error('Excel parsing failed', {
        errors: parseResult.errors,
        filename,
      });

      return NextResponse.json(
        {
          success: false,
          error: 'Failed to parse Excel file',
          details: parseResult.errors,
        },
        { status: 400 }
      );
    }

    if (parseResult.rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Excel file contains no data rows',
        },
        { status: 400 }
      );
    }

    // Create column mapping from headers
    const columnMapping = createDefaultColumnMapping(parseResult.headers || []);

    // Generate preview
    const preview = generatePreview(parseResult.rows, columnMapping, {
      sampleSize: 10,
      checkDuplicates: true,
    });

    logger.info('Parse complete', {
      filename,
      totalRows: parseResult.total_rows,
      validRows: preview.valid_rows,
      invalidRows: preview.invalid_rows,
    });

    return NextResponse.json({
      success: true,
      data: {
        filename,
        headers: parseResult.headers,
        total_rows: parseResult.total_rows,
        skipped_rows: parseResult.skipped_rows,
        valid_count: preview.valid_rows,
        invalid_count: preview.invalid_rows,
        can_proceed: preview.can_proceed,
        sample_rows: preview.sample_rows,
        validation_errors: preview.validation_errors,
        column_mapping: preview.column_mapping,
      },
    });
  } catch (error) {
    logger.error('Error parsing file', { error });

    // Handle JSON parse errors specifically
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid JSON body',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to parse file',
      },
      { status: 500 }
    );
  }
}
