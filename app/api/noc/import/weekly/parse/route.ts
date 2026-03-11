/**
 * Weekly Import Parse API - Preview Excel File
 *
 * POST /api/noc/import/weekly/parse - Parse Excel file and return preview
 *
 * Accepts:
 * - FormData with 'file' field (preferred - more efficient)
 * - JSON body with { filename, data: number[] } (legacy)
 *
 * Auto-detects the best sheet with ticket data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import * as XLSX from 'xlsx';
import {
  parseExcelFile,
  generatePreview,
  createDefaultColumnMapping,
} from '@/modules/noc/utils/excelParser';

// Known ticket data column names (case-insensitive)
const TICKET_COLUMNS = [
  'dr number', 'dr_number', 'drnumber',
  'status', 'area', 'zone',
  'ft ref', 'ft_ref', 'ftref', 'reference',
  'issue', 'description', 'title',
  'date', 'date captured', 'date_captured'
];

const logger = createLogger('maintenance:api:weekly-import:parse');

// Configuration
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const VALID_FILE_EXTENSIONS = ['.xlsx', '.xls'];

export async function POST(req: NextRequest) {
  try {
    let filename: string;
    let buffer: Buffer;
    let sheetNameParam: string | undefined;

    const contentType = req.headers.get('content-type') || '';

    // Handle FormData (preferred - more efficient)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return NextResponse.json(
          { success: false, error: 'File is required' },
          { status: 400 }
        );
      }

      filename = file.name;
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      sheetNameParam = formData.get('sheetName') as string | undefined;
    }
    // Handle JSON body (legacy)
    else {
      const body = await req.json();
      const { filename: jsonFilename, data } = body;

      if (!jsonFilename || typeof jsonFilename !== 'string') {
        return NextResponse.json(
          { success: false, error: 'Filename is required' },
          { status: 400 }
        );
      }

      if (!data || !Array.isArray(data)) {
        return NextResponse.json(
          { success: false, error: 'File data is required' },
          { status: 400 }
        );
      }

      filename = jsonFilename;
      buffer = Buffer.from(data);
      sheetNameParam = body.sheetName;
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
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
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
      size: buffer.length,
    });

    // Auto-detect the best sheet if not specified
    let sheetName = sheetNameParam;
    let availableSheets: { name: string; rows: number; hasTicketColumns: boolean }[] = [];

    if (!sheetName) {
      const workbook = XLSX.read(buffer, { type: 'buffer' });

      // Score each sheet
      availableSheets = workbook.SheetNames.map(name => {
        const sheet = workbook.Sheets[name];
        const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
        const rows = range ? range.e.r - range.s.r + 1 : 0;

        // Get headers from first row
        const firstRow = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[] || [];
        const headerLower = firstRow.map(h => String(h || '').toLowerCase());

        // Check if any ticket columns exist
        const hasTicketColumns = TICKET_COLUMNS.some(col =>
          headerLower.some(h => h.includes(col))
        );

        return { name, rows, hasTicketColumns };
      });

      // Score sheets: prefer "ticket"/"mnt" in name, then by row count
      const scoredSheets = availableSheets.map(s => {
        let score = s.rows;
        const nameLower = s.name.toLowerCase();
        // Strong preference for sheets with "ticket" or "mnt" in name
        if (nameLower.includes('ticket')) score += 10000;
        if (nameLower.includes('mnt')) score += 5000;
        if (nameLower.includes('maintenance')) score += 5000;
        // Boost for having ticket columns
        if (s.hasTicketColumns) score += 1000;
        // Penalize pivot/summary sheets
        if (nameLower.includes('pivot') || nameLower.includes('summary')) score -= 5000;
        return { ...s, score };
      });

      // Pick highest scored sheet
      sheetName = scoredSheets.sort((a, b) => b.score - a.score)[0]?.name;

      logger.info('Auto-detected sheet', {
        selectedSheet: sheetName,
        availableSheets: availableSheets.map(s => `${s.name} (${s.rows} rows, ticket cols: ${s.hasTicketColumns})`),
      });
    }

    // Parse Excel file with detected/specified sheet
    const parseResult = await parseExcelFile(buffer, {
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
        selected_sheet: sheetName,
        available_sheets: availableSheets.length > 0 ? availableSheets : undefined,
        headers: parseResult.headers,
        total_rows: parseResult.total_rows,
        skipped_rows: parseResult.skipped_rows,
        valid_rows: preview.valid_rows,
        invalid_rows: preview.invalid_rows,
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
