/**
 * Excel Data Formatter
 * Handles formatting and type conversion of Excel cell values
 */

import * as XLSX from 'xlsx';

/**
 * Excel data formatting utilities
 */
export class ExcelFormatter {
  /**
   * Format cell values from Excel to consistent types
   */
  static formatCellValue(value: unknown): string | number {
    if (value === null || value === undefined) {
      return '';
    }

    // Handle dates
    if (value instanceof Date) {
      return value.toISOString().split('T')[0] ?? ''; // YYYY-MM-DD format
    }

    // Handle numbers
    if (typeof value === 'number') {
      // Check if it's likely a date serial number from Excel
      if (this.isExcelDate(value)) {
        const date = this.excelDateToJSDate(value);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0] ?? '';
        }
      }
      return value;
    }

    // Convert everything else to string and trim
    return String(value).trim();
  }

  /**
   * Convert Excel date serial number to JavaScript Date
   */
  static excelDateToJSDate(excelDate: number): Date {
    // Excel's date system starts from January 1, 1900 (with a bug that treats 1900 as a leap year)
    const excelEpoch = new Date(1900, 0, 1);
    const msPerDay = 24 * 60 * 60 * 1000;

    // Subtract 1 to account for Excel's leap year bug and 1-based indexing
    const daysSinceEpoch = excelDate - 2;

    return new Date(excelEpoch.getTime() + daysSinceEpoch * msPerDay);
  }

  /**
   * Detect if a number is likely an Excel date
   */
  static isExcelDate(value: number): boolean {
    // Excel dates are typically between 1900-01-01 (1) and 2100-12-31 (73413)
    // More conservative range for common dates
    return value > 25569 && value < 50000 && Number.isInteger(value);
  }

  /**
   * Get cell value with type information
   */
  static getCellInfo(worksheet: XLSX.WorkSheet, cellAddress: string): {
    value: unknown;
    type: string;
    formatted: string;
  } {
    const cell = worksheet[cellAddress];

    if (!cell) {
      return { value: '', type: 'empty', formatted: '' };
    }

    const cellType = cell.t || 'unknown';
    const value: unknown = cell.v;
    const formatted = cell.w || String(value);

    return {
      value,
      type: cellType,
      formatted
    };
  }

  /**
   * Convert array data to object format using headers
   */
  static convertArrayToObjects(jsonData: unknown[][]): Record<string, unknown>[] {
    if (jsonData.length === 0) {
      return [];
    }

    // Convert to object format using first row as headers
    const headers = jsonData[0] as string[];
    const rows = jsonData.slice(1).map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        const cellValue = row[index];
        obj[header] = this.formatCellValue(cellValue);
      });
      return obj;
    });

    return rows;
  }

  /**
   * Clean and normalize header names
   */
  static normalizeHeaders(headers: string[]): string[] {
    return headers.map(header => {
      if (!header || typeof header !== 'string') {
        return 'Unknown';
      }

      return header
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/__+/g, '_')
        .replace(/^_|_$/g, '');
    });
  }

  /**
   * Format numeric values with proper precision
   */
  static formatNumericValue(value: unknown, decimalPlaces: number = 2): number | null {
    const num = parseFloat(String(value));
    if (isNaN(num)) {
      return null;
    }

    return parseFloat(num.toFixed(decimalPlaces));
  }

  /**
   * Format percentage values
   */
  static formatPercentageValue(value: unknown): number | null {
    const num = parseFloat(String(value));
    if (isNaN(num)) {
      return null;
    }

    // If value is already in decimal form (0.15 for 15%), keep as is
    // If value is in percentage form (15 for 15%), convert to decimal
    return num > 1 ? num / 100 : num;
  }
}
