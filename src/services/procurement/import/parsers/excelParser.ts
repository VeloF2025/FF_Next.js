/**
 * Excel Parser
 * Unified interface for Excel file parsing using modular components
 */

import * as XLSX from 'xlsx';
import { ExcelReader } from './excelReader';
import { ExcelFormatter } from './excelFormatter';
import { ExcelConverter, ConversionOptions } from './excelConverter';

/**
 * Main Excel Parser class - provides backward compatibility
 * Uses the new modular components internally
 */
export class ExcelParser {
  /**
   * Read Excel file using XLSX library
   * @deprecated Use ExcelConverter.parseExcelFile instead
   */
  static async parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
    return ExcelConverter.parseExcelFile(file);
  }

  /**
   * Parse specific worksheet from Excel file
   * @deprecated Use ExcelConverter.parseSpecificWorksheet instead
   */
  static async parseSpecificWorksheet(file: File, worksheetName: string): Promise<Record<string, unknown>[]> {
    return ExcelConverter.parseSpecificWorksheet(file, worksheetName);
  }

  /**
   * Format cell values from Excel to consistent types
   * @deprecated Use ExcelFormatter.formatCellValue instead
   */
  static formatCellValue(value: unknown): string | number {
    return ExcelFormatter.formatCellValue(value);
  }

  /**
   * Get all worksheet names from Excel file
   * @deprecated Use ExcelReader.getWorksheetNames instead
   */
  static async getWorksheetNames(file: File): Promise<string[]> {
    return ExcelReader.getWorksheetNames(file);
  }

  /**
   * Get worksheet data range information
   * @deprecated Use ExcelReader.getWorksheetInfo instead
   */
  static async getWorksheetInfo(file: File, worksheetName: string): Promise<{
    rowCount: number;
    columnCount: number;
    range: string;
  }> {
    return ExcelReader.getWorksheetInfo(file, worksheetName);
  }

  /**
   * Parse Excel file with custom options
   * @deprecated Use ExcelConverter.parseExcelWithOptions instead
   */
  static async parseExcelWithOptions(
    file: File, 
    options: {
      worksheet?: string;
      headerRow?: number;
      skipEmptyRows?: boolean;
      range?: string;
    } = {}
  ): Promise<Record<string, unknown>[]> {
    return ExcelConverter.parseExcelWithOptions(file, options as ConversionOptions);
  }

  /**
   * Convert Excel date serial number to JavaScript Date
   * @deprecated Use ExcelFormatter.excelDateToJSDate instead
   */
  static excelDateToJSDate(excelDate: number): Date {
    return ExcelFormatter.excelDateToJSDate(excelDate);
  }

  /**
   * Detect if a number is likely an Excel date
   * @deprecated Use ExcelFormatter.isExcelDate instead
   */
  static isExcelDate(value: number): boolean {
    return ExcelFormatter.isExcelDate(value);
  }

  /**
   * Get cell value with type information
   * @deprecated Use ExcelFormatter.getCellInfo instead
   */
  static getCellInfo(worksheet: XLSX.WorkSheet, cellAddress: string): {
    value: unknown;
    type: string;
    formatted: string;
  } {
    return ExcelFormatter.getCellInfo(worksheet, cellAddress);
  }

  /**
   * Validate Excel file structure
   * @deprecated Use ExcelReader.validateExcelStructure instead
   */
  static async validateExcelStructure(file: File): Promise<{
    isValid: boolean;
    errors: string[];
    worksheets: string[];
  }> {
    return ExcelReader.validateExcelStructure(file);
  }
}

// Re-export the new modular components
export { ExcelReader } from './excelReader';
export { ExcelFormatter } from './excelFormatter';
export { ExcelConverter } from './excelConverter';
export type { ConversionOptions } from './excelConverter';