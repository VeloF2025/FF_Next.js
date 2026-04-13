/**
 * Excel Reader Processor
 * Handles reading Excel files with streaming support
 */

import ExcelJS from 'exceljs';
import { log } from '@/lib/logger';
import { SecureExcelOptions, ExcelReadResult, ProcessingError } from '../types/excel.types';
import { CHUNK_SIZE, MAX_FILE_SIZE, MAX_ROWS, MAX_COLUMNS, MAX_CELL_LENGTH } from '../constants/excelConstants';
import { validateFileSize } from '../validators/securityValidators';
import { sanitizeCellValue } from '../validators/cellSanitizer';
import { validateHasWorksheets, validateWorksheetDimensions } from '../validators/workbookValidators';
import { extractHeaders, getColumnLetter, getPerformanceMetrics, requestGarbageCollection } from '../utils/excelUtils';

/**
 * Read Excel file with streaming support for better performance
 */
export async function readExcelFile<T = Record<string, unknown>>(
  buffer: ArrayBuffer,
  options: SecureExcelOptions = {}
): Promise<ExcelReadResult<T>> {
  const startTime = performance.now();
  const initialMemory = process.memoryUsage?.()?.heapUsed || 0;

  const {
    maxFileSize = MAX_FILE_SIZE,
    maxRows = MAX_ROWS,
    maxColumns = MAX_COLUMNS,
    maxCellLength = MAX_CELL_LENGTH,
    allowFormulas = false,
    allowHTML = false,
    chunkSize = CHUNK_SIZE,
    useStreaming = true
  } = options;

  try {
    // Security validation
    validateFileSize(buffer, maxFileSize);

    // Create workbook instance
    const workbook = new ExcelJS.Workbook();

    // Load workbook from buffer
    await workbook.xlsx.load(buffer);

    validateHasWorksheets(workbook);

    // Use first worksheet (validated by validateHasWorksheets above)
    const worksheet = workbook.worksheets[0]!;
    const worksheetName = worksheet.name;

    // Validate worksheet dimensions
    validateWorksheetDimensions(worksheet, maxRows, maxColumns);

    const data: T[] = [];
    const errors: ProcessingError[] = [];

    // Get headers from first row
    const headers = extractHeaders(
      worksheet,
      (value) => sanitizeCellValue(value, maxCellLength, allowHTML),
      (row, column, message) => errors.push({ row, column, message })
    );

    // Process data rows in chunks for better memory management
    if (useStreaming && worksheet.rowCount > chunkSize) {
      await processWithStreaming(worksheet, headers, data, errors, {
        allowFormulas,
        allowHTML,
        maxCellLength,
        chunkSize
      });
    } else {
      processWithoutStreaming(worksheet, headers, data, errors, {
        allowFormulas,
        allowHTML,
        maxCellLength
      });
    }

    const { processingTime, memoryUsed } = getPerformanceMetrics(startTime, initialMemory);

    log.info('Excel file processed successfully', {
      rows: data.length,
      errors: errors.length,
      processingTime,
      memoryUsed: Math.round(memoryUsed / 1024),
      useStreaming
    }, 'secure-excel');

    return {
      data,
      errors,
      metadata: {
        totalRows: worksheet.rowCount,
        totalColumns: worksheet.columnCount,
        worksheetName,
        processingTime,
        memoryUsed
      }
    };

  } catch (error) {
    log.error('Excel processing failed:', { data: error }, 'secure-excel');
    throw new Error(`Excel processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Process worksheet with streaming (for large files)
 */
async function processWithStreaming<T>(
  worksheet: ExcelJS.Worksheet,
  headers: string[],
  data: T[],
  errors: ProcessingError[],
  options: { allowFormulas: boolean; allowHTML: boolean; maxCellLength: number; chunkSize: number }
): Promise<void> {
  const { allowFormulas, allowHTML, maxCellLength, chunkSize } = options;

  for (let startRow = 2; startRow <= worksheet.rowCount; startRow += chunkSize) {
    const endRow = Math.min(startRow + chunkSize - 1, worksheet.rowCount);

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
      processRow(worksheet.getRow(rowIndex), rowIndex, headers, data, errors, {
        allowFormulas,
        allowHTML,
        maxCellLength
      });
    }

    // Memory management - force garbage collection opportunity
    if ((startRow % (chunkSize * 5)) === 0) {
      requestGarbageCollection();
    }
  }
}

/**
 * Process worksheet without streaming (for smaller files)
 */
function processWithoutStreaming<T>(
  worksheet: ExcelJS.Worksheet,
  headers: string[],
  data: T[],
  errors: ProcessingError[],
  options: { allowFormulas: boolean; allowHTML: boolean; maxCellLength: number }
): void {
  worksheet.eachRow((row, rowIndex) => {
    if (rowIndex === 1) return; // Skip header row

    processRow(row, rowIndex, headers, data, errors, options);
  });
}

/**
 * Process a single row
 */
function processRow<T>(
  row: ExcelJS.Row,
  rowIndex: number,
  headers: string[],
  data: T[],
  errors: ProcessingError[],
  options: { allowFormulas: boolean; allowHTML: boolean; maxCellLength: number }
): void {
  const { allowFormulas, allowHTML, maxCellLength } = options;

  try {
    const rowData: Record<string, unknown> = {};

    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        try {
          // Block formulas if not allowed
          if (!allowFormulas && cell.type === ExcelJS.ValueType.Formula) {
            throw new Error(
              `Formula detected in cell ${getColumnLetter(colNumber)}${rowIndex}. Formulas are not allowed.`
            );
          }

          rowData[header] = sanitizeCellValue(cell.value, maxCellLength, allowHTML);
        } catch (cellError) {
          errors.push({
            row: rowIndex,
            column: getColumnLetter(colNumber),
            message: `Cell error: ${cellError instanceof Error ? cellError.message : 'Unknown error'}`
          });
        }
      }
    });

    if (Object.keys(rowData).length > 0) {
      data.push(rowData as T);
    }

  } catch (rowError) {
    errors.push({
      row: rowIndex,
      message: `Row error: ${rowError instanceof Error ? rowError.message : 'Unknown error'}`
    });
  }
}
