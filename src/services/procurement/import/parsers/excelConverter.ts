/**
 * Excel Data Converter
 * Converts Excel worksheets to structured data formats
 */

import * as XLSX from 'xlsx';
import { ExcelReader } from './excelReader';
import { ExcelFormatter } from './excelFormatter';

export interface ConversionOptions {
  worksheet?: string;
  headerRow?: number;
  skipEmptyRows?: boolean;
  range?: string;
  normalizeHeaders?: boolean;
}

interface XlsxSheetOptions {
  header: number;
  defval: string;
  blankrows: boolean;
  raw: boolean;
  range?: string;
}

/**
 * Excel data conversion utilities
 */
export class ExcelConverter {
  /**
   * Parse Excel file with default settings
   */
  static async parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
    const workbook = await ExcelReader.readFile(file);

    // Use first sheet by default
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }

    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON with header row as keys
    const jsonData = XLSX.utils.sheet_to_json(worksheet!, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false // Convert values to strings
    });

    if (jsonData.length === 0) {
      return [];
    }

    return ExcelFormatter.convertArrayToObjects(jsonData as unknown[][]);
  }

  /**
   * Parse specific worksheet from Excel file
   */
  static async parseSpecificWorksheet(file: File, worksheetName: string): Promise<Record<string, unknown>[]> {
    const workbook = await ExcelReader.readFile(file);

    if (!workbook.SheetNames.includes(worksheetName)) {
      throw new Error(`Worksheet "${worksheetName}" not found`);
    }

    const worksheet = workbook.Sheets[worksheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet!, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false
    });

    if (jsonData.length === 0) {
      return [];
    }

    return ExcelFormatter.convertArrayToObjects(jsonData as unknown[][]);
  }

  /**
   * Parse Excel file with custom options
   */
  static async parseExcelWithOptions(
    file: File,
    options: ConversionOptions = {}
  ): Promise<Record<string, unknown>[]> {
    const workbook = await ExcelReader.readFile(file);

    const sheetName = options.worksheet || workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }

    const worksheet = workbook.Sheets[sheetName];

    const xlsxOptions: XlsxSheetOptions = {
      header: options.headerRow || 1,
      defval: '',
      blankrows: !options.skipEmptyRows,
      raw: false
    };

    if (options.range) {
      xlsxOptions.range = options.range;
    }

    const jsonData = XLSX.utils.sheet_to_json(worksheet!, xlsxOptions);

    // Handle header normalization if requested
    if (options.normalizeHeaders && Array.isArray(jsonData) && jsonData.length > 0) {
      const firstRow = jsonData[0];
      if (typeof firstRow === 'object' && firstRow !== null) {
        const headers = Object.keys(firstRow as Record<string, unknown>);
        const normalizedHeaders = ExcelFormatter.normalizeHeaders(headers);

        // Create mapping from old to new headers
        const headerMap = new Map<string, string>();
        headers.forEach((header, index) => {
          headerMap.set(header, normalizedHeaders[index]!);
        });

        // Transform all rows to use normalized headers
        return jsonData.map((row) => {
          const normalizedRow: Record<string, unknown> = {};
          Object.entries(row as Record<string, unknown>).forEach(([key, value]) => {
            const normalizedKey = headerMap.get(key) || key;
            normalizedRow[normalizedKey] = ExcelFormatter.formatCellValue(value);
          });
          return normalizedRow;
        });
      }
    }

    return jsonData as Record<string, unknown>[];
  }

  /**
   * Convert Excel data to typed objects with validation
   */
  static async parseExcelWithSchema<T>(
    file: File,
    schema: (row: Record<string, unknown>) => T | null,
    options: ConversionOptions = {}
  ): Promise<{ data: T[]; errors: string[] }> {
    try {
      const rawData = await this.parseExcelWithOptions(file, options);
      const data: T[] = [];
      const errors: string[] = [];

      rawData.forEach((row, index) => {
        try {
          const typedRow = schema(row);
          if (typedRow !== null) {
            data.push(typedRow);
          } else {
            errors.push(`Row ${index + 1}: Invalid data format`);
          }
        } catch (error) {
          errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      });

      return { data, errors };
    } catch (error) {
      return {
        data: [],
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
    }
  }

  /**
   * Extract specific columns from Excel data
   */
  static async extractColumns(
    file: File,
    columnNames: string[],
    options: ConversionOptions = {}
  ): Promise<Record<string, unknown[]>> {
    const data = await this.parseExcelWithOptions(file, options);
    const result: Record<string, unknown[]> = {};

    columnNames.forEach(columnName => {
      result[columnName] = data
        .map(row => row[columnName])
        .filter(value => value !== undefined && value !== null && value !== '');
    });

    return result;
  }
}
