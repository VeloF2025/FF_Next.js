/**
 * Excel Processing Utilities
 */

import ExcelJS from 'exceljs';

/**
 * Convert column number to Excel letter (e.g., 1 -> A, 27 -> AA)
 */
export function getColumnLetter(colNumber: number): string {
  return String.fromCharCode(64 + colNumber);
}

/**
 * Extract headers from first row of worksheet
 */
export function extractHeaders(
  worksheet: ExcelJS.Worksheet,
  sanitizeValue: (value: ExcelJS.CellValue) => string,
  onError: (row: number, column: string, message: string) => void
): string[] {
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];

  headerRow.eachCell((cell, colNumber) => {
    try {
      const headerValue = sanitizeValue(cell.value);
      headers[colNumber - 1] = headerValue;
    } catch (error) {
      onError(
        1,
        getColumnLetter(colNumber),
        `Header error: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  });

  return headers;
}

/**
 * Calculate optimal column width based on content
 */
export function calculateColumnWidth<T>(
  data: T[],
  header: string,
  sampleSize: number = 100
): number {
  let maxLength = header.length;

  const samplesToCheck = Math.min(sampleSize, data.length);
  for (let i = 0; i < samplesToCheck; i++) {
    const value = String((data[i] as Record<string, unknown>)[header] || '');
    maxLength = Math.max(maxLength, value.length);
  }

  // Min 10, max 50, with 2 char padding
  return Math.min(Math.max(maxLength + 2, 10), 50);
}

/**
 * Trigger garbage collection if available
 */
export function requestGarbageCollection(): void {
  if (global.gc) {
    global.gc();
  }
}

/**
 * Get performance metrics
 */
export function getPerformanceMetrics(startTime: number, initialMemory: number) {
  const endTime = performance.now();
  const finalMemory = process.memoryUsage?.()?.heapUsed || 0;
  const processingTime = Math.round(endTime - startTime);
  const memoryUsed = Math.max(0, finalMemory - initialMemory);

  return {
    processingTime,
    memoryUsed
  };
}
