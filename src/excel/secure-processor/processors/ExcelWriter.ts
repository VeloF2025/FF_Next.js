/**
 * Excel Writer Processor
 * Handles creating Excel files with optimized performance
 */

import ExcelJS from 'exceljs';
import { log } from '@/lib/logger';
import { SecureExcelOptions } from '../types/excel.types';
import { CHUNK_SIZE } from '../constants/excelConstants';
import { sanitizeCellValue } from '../validators/cellSanitizer';
import { calculateColumnWidth, requestGarbageCollection } from '../utils/excelUtils';

/**
 * Create Excel file with optimized performance
 */
export async function createExcelFile<T extends Record<string, unknown> = Record<string, unknown>>(
  data: T[],
  worksheetName: string = 'Data',
  options: SecureExcelOptions = {}
): Promise<ArrayBuffer> {
  const startTime = performance.now();

  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(worksheetName);

    if (data.length === 0) {
      throw new Error('No data provided for Excel export');
    }

    // Get headers from first data item
    const headers = Object.keys(data[0] as Record<string, unknown>);

    // Add header row with styling
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows in chunks for better memory management
    const chunkSize = options.chunkSize || CHUNK_SIZE;

    for (let i = 0; i < data.length; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);

      for (const item of chunk) {
        const rowData = headers.map(header => {
          const value = (item as Record<string, unknown>)[header];
          return sanitizeCellValue(value, options.maxCellLength, options.allowHTML);
        });
        worksheet.addRow(rowData);
      }

      // Memory management
      if (i % (chunkSize * 5) === 0) {
        requestGarbageCollection();
      }
    }

    // Auto-fit columns for better readability
    worksheet.columns.forEach((column, index) => {
      const header = headers[index];
      if (header !== undefined) {
        column.width = calculateColumnWidth(data, header);
      }
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();

    const endTime = performance.now();
    log.info('Excel file created successfully', {
      rows: data.length,
      columns: headers.length,
      processingTime: Math.round(endTime - startTime),
      bufferSize: Math.round(buffer.byteLength / 1024)
    }, 'secure-excel');

    return buffer as ArrayBuffer;

  } catch (error) {
    log.error('Excel creation failed:', { data: error }, 'secure-excel');
    throw new Error(`Excel creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
