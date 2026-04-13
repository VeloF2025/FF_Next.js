/**
 * Secure Excel Processor
 * High-performance, security-focused Excel processing using ExcelJS
 * Replaces vulnerable xlsx library with streaming support and better performance
 *
 * This is a thin orchestrator that delegates to specialized processors
 */

// Re-export types
export type {
  SecureExcelOptions,
  ExcelReadResult,
  ExcelValidationResult,
  ProcessingError
} from './secure-processor/types/excel.types';

// Re-export constants for consumers that need them
export {
  MAX_FILE_SIZE,
  MAX_ROWS,
  MAX_COLUMNS,
  MAX_CELL_LENGTH,
  CHUNK_SIZE
} from './secure-processor/constants/excelConstants';

// Import processors
import { readExcelFile as readExcel } from './secure-processor/processors/ExcelReader';
import { createExcelFile as createExcel } from './secure-processor/processors/ExcelWriter';
import { validateExcelFile as validateExcel } from './secure-processor/processors/ExcelValidator';

/**
 * SecureExcelProcessor class - maintains backward compatibility
 */
export class SecureExcelProcessor {
  /**
   * Read Excel file with streaming support for better performance
   */
  static async readExcelFile<T = Record<string, unknown>>(
    buffer: ArrayBuffer,
    options = {}
  ) {
    return readExcel<T>(buffer, options);
  }

  /**
   * Create Excel file with optimized performance
   */
  static async createExcelFile<T extends Record<string, unknown> = Record<string, unknown>>(
    data: T[],
    worksheetName: string = 'Data',
    options = {}
  ) {
    return createExcel<T>(data, worksheetName, options);
  }

  /**
   * Validate Excel file without full processing
   */
  static async validateExcelFile(
    buffer: ArrayBuffer,
    options = {}
  ) {
    return validateExcel(buffer, options);
  }
}

// Convenience functions for common use cases
export const readExcelFile = SecureExcelProcessor.readExcelFile.bind(SecureExcelProcessor);
export const createExcelFile = SecureExcelProcessor.createExcelFile.bind(SecureExcelProcessor);
export const validateExcelFile = SecureExcelProcessor.validateExcelFile.bind(SecureExcelProcessor);

export default SecureExcelProcessor;
