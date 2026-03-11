/**
 * Import Engine - Data Processing
 * Handles row-by-row data processing and validation
 */

import { 
  ProcessingContext, 
  ChunkProcessingResult, 
  ParsedBOQItem,
  ImportError,
  ImportWarning,
  ColumnMapping
} from './types';
import { mapRowToBoqItem } from '../columnMapping';
import { validateBOQItem, validateDataConsistency } from '../importValidation';

export class DataProcessor {
  /**
   * Process a single row of data
   */
  processRow(
    row: Record<string, any>,
    rowIndex: number,
    columnMapping: ColumnMapping
  ): {
    validItem: ParsedBOQItem | undefined;
    errors: ImportError[];
    warnings: ImportWarning[];
    success: boolean;
  } {
    const rowErrors: ImportError[] = [];
    const rowWarnings: ImportWarning[] = [];

    // Map row to BOQ item
    const mappedData = mapRowToBoqItem(row, rowIndex, columnMapping, rowErrors, rowWarnings);

    // Validate the mapped item
    const validationResult = validateBOQItem(mappedData, rowIndex + 1);

    rowErrors.push(...validationResult.errors);
    rowWarnings.push(...validationResult.warnings);

    return {
      validItem: validationResult.success ? validationResult.data : undefined,
      errors: rowErrors,
      warnings: rowWarnings,
      success: validationResult.success
    };
  }

  /**
   * Process multiple rows sequentially
   */
  processRows(
    rows: Record<string, any>[],
    startIndex: number,
    columnMapping: ColumnMapping
  ): ChunkProcessingResult {
    const validItems: ParsedBOQItem[] = [];
    const errors: ImportError[] = [];
    const warnings: ImportWarning[] = [];
    let processedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const globalRowIndex = startIndex + i;
      const row = rows[i];

      const result = this.processRow(row!, globalRowIndex, columnMapping);

      errors.push(...result.errors);
      warnings.push(...result.warnings);

      if (result.validItem) {
        validItems.push(result.validItem);
      }

      processedCount++;
    }

    return {
      validItems,
      errors,
      warnings,
      processedCount
    };
  }

  /**
   * Update processing context with results from a chunk
   */
  updateContextWithResults(
    context: ProcessingContext,
    chunkResult: ChunkProcessingResult
  ): void {
    context.validItems.push(...chunkResult.validItems);
    context.errors.push(...chunkResult.errors);
    context.warnings.push(...chunkResult.warnings);
    context.processedRows += chunkResult.processedCount;
  }

  /**
   * Calculate processing statistics
   */
  calculateStats(errors: ImportError[], warnings: ImportWarning[]) {
    const errorRows = errors.filter((e, i, arr) => 
      arr.findIndex(err => err.row === e.row) === i
    ).length;

    const warningRows = warnings.filter((w, i, arr) => 
      arr.findIndex(warn => warn.row === w.row) === i
    ).length;

    return {
      errorRows,
      warningRows
    };
  }

  /**
   * Perform data consistency validation
   */
  validateConsistency(validItems: ParsedBOQItem[]): {
    errors: ImportError[];
    warnings: ImportWarning[];
  } {
    return validateDataConsistency(validItems);
  }

  /**
   * Determine if processing was successful
   */
  isProcessingSuccessful(dataLength: number, errorCount: number): boolean {
    return dataLength > 0 && errorCount === 0;
  }
}