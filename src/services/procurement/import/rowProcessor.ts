/**
 * Row Processor
 * Handles individual row processing and validation
 */

import type { 
  ParsedBOQItem, 
  ImportError, 
  ImportWarning, 
  ColumnMapping, 
  ImportResult 
} from './importTypes';
import { mapRowToBoqItem } from './columnMapping';
import { validateBOQItem } from './importValidation';

export class RowProcessor {
  /**
   * Process a single row with mapping and validation
   */
  processRow(
    row: Record<string, unknown>,
    index: number,
    columnMapping: ColumnMapping
  ): {
    item: ParsedBOQItem | undefined;
    errors: ImportError[];
    warnings: ImportWarning[];
    isValid: boolean;
  } {
    const rowErrors: ImportError[] = [];
    const rowWarnings: ImportWarning[] = [];

    // Map row to BOQ item
    const mappedData = mapRowToBoqItem(row, index, columnMapping, rowErrors, rowWarnings);

    // Validate the mapped item
    const validationResult = validateBOQItem(mappedData, index + 1);

    rowErrors.push(...validationResult.errors);
    rowWarnings.push(...validationResult.warnings);

    return {
      item: validationResult.success ? validationResult.data : undefined,
      errors: rowErrors,
      warnings: rowWarnings,
      isValid: validationResult.success
    };
  }

  /**
   * Process multiple rows in batch
   */
  processBatch(
    rows: Record<string, unknown>[],
    startIndex: number,
    columnMapping: ColumnMapping
  ): {
    validItems: ParsedBOQItem[];
    errors: ImportError[];
    warnings: ImportWarning[];
    stats: {
      validRows: number;
      errorRows: number;
      warningRows: number;
    };
  } {
    const validItems: ParsedBOQItem[] = [];
    const errors: ImportError[] = [];
    const warnings: ImportWarning[] = [];
    let validRows = 0;
    let errorRows = 0;
    let warningRows = 0;

    for (let i = 0; i < rows.length; i++) {
      const globalIndex = startIndex + i;
      const result = this.processRow(rows[i]!, globalIndex, columnMapping);

      if (result.item) {
        validItems.push(result.item);
      }

      errors.push(...result.errors);
      warnings.push(...result.warnings);

      // Update statistics
      if (result.errors.length > 0) {
        errorRows++;
      } else if (result.warnings.length > 0) {
        warningRows++;
      } else {
        validRows++;
      }
    }

    return {
      validItems,
      errors,
      warnings,
      stats: {
        validRows,
        errorRows,
        warningRows
      }
    };
  }

  /**
   * Update result statistics based on unique row errors/warnings
   */
  updateResultStats(result: ImportResult): void {
    // Update final statistics to count unique rows with errors/warnings
    const uniqueErrorRows = new Set(result.errors.map(e => e.row));
    const uniqueWarningRows = new Set(result.warnings.map(w => w.row));

    result.stats.errorRows = uniqueErrorRows.size;
    result.stats.warningRows = uniqueWarningRows.size;
  }
}