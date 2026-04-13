/**
 * Excel Parser - Data Processing
 * Handles raw data transformation and item parsing
 */

import { 
  RawBOQRow,
  ParsedBOQItem,
  ParseConfig,
  ColumnMapping,
  ProcessingStats,
  ProgressCallback,
  ParseError,
  ParseWarning
} from './types';
import { 
  isEmptyRow,
  isSummaryRow,
  normalizeUOM,
  parseNumericValue,
  cleanText,
  validateBOQItem
} from '../validation';
import { ColumnMapper } from './columnMapper';

export class DataProcessor {
  private config: ParseConfig;
  private columnMapper: ColumnMapper;
  private errors: ParseError[] = [];
  private warnings: ParseWarning[] = [];

  constructor(config: ParseConfig) {
    this.config = config;
    this.columnMapper = new ColumnMapper(config);
  }

  /**
   * Process raw data array into structured BOQ items
   */
  processRawData(
    rawData: string[][],
    onProgress?: ProgressCallback
  ): {
    items: ParsedBOQItem[];
    stats: ProcessingStats;
    errors: ParseError[];
    warnings: ParseWarning[];
  } {
    this.resetErrors();

    if (rawData.length === 0) {
      this.addError(0, '', null, 'File is empty or contains no valid data', 'validation');
      return this.buildProcessingResult([], { totalRows: 0, processedRows: 0, skippedRows: 0 });
    }

    // Detect headers and create column mapping
    const headerRow = this.columnMapper.detectHeaders(rawData);
    const columnMapping = this.columnMapper.mapColumns(headerRow);

    // Process data rows
    const dataRowsStartIndex = (this.config.headerRow || 0) + 1 + (this.config.skipRows || 0);
    const dataRows = rawData.slice(dataRowsStartIndex);
    
    return this.processDataRows(dataRows, columnMapping, dataRowsStartIndex, onProgress);
  }

  /**
   * Process data rows into BOQ items
   */
  private processDataRows(
    dataRows: string[][],
    columnMapping: ColumnMapping[],
    startIndex: number,
    onProgress?: ProgressCallback
  ): {
    items: ParsedBOQItem[];
    stats: ProcessingStats;
    errors: ParseError[];
    warnings: ParseWarning[];
  } {
    const items: ParsedBOQItem[] = [];
    let processedRows = 0;
    let skippedRows = 0;

    dataRows.forEach((row, index) => {
      const rowNum = index + startIndex + 1;
      
      // Convert array to object using column mapping
      const rawItem = this.columnMapper.arrayToObject(row, columnMapping);
      
      // Skip empty or summary rows
      if (this.shouldSkipRow(rawItem)) {
        skippedRows++;
        return;
      }

      // Parse and validate item
      const parsedItem = this.parseItem(rawItem, rowNum);
      if (parsedItem) {
        items.push(parsedItem);
        processedRows++;
      } else {
        skippedRows++;
      }

      // Update progress periodically
      this.updateProgress(onProgress, processedRows, dataRows.length);
    });

    onProgress?.(1.0);
    
    return this.buildProcessingResult(items, {
      totalRows: dataRows.length,
      processedRows,
      skippedRows
    });
  }

  /**
   * Check if row should be skipped
   */
  private shouldSkipRow(rawItem: RawBOQRow): boolean {
    return isEmptyRow(rawItem) || isSummaryRow(rawItem);
  }

  /**
   * Parse raw item into validated BOQ item
   */
  private parseItem(raw: RawBOQRow, rowNum: number): ParsedBOQItem | null {
    try {
      const item = this.buildParsedItem(raw, rowNum);
      return this.validateAndReturnItem(item, rowNum);
    } catch (error) {
      this.addError(
        rowNum,
        '',
        raw,
        `Failed to parse row: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'parsing'
      );
      return null;
    }
  }

  /**
   * Build parsed item from raw data
   */
  private buildParsedItem(raw: RawBOQRow, rowNum: number): Partial<ParsedBOQItem> {
    return {
      lineNumber: rowNum,
      itemCode: cleanText(raw.itemCode),
      description: cleanText(raw.description) || '',
      uom: normalizeUOM(cleanText(raw.uom) || ''),
      quantity: parseNumericValue(raw.quantity, this.config.locale) || 0,
      phase: cleanText(raw.phase),
      task: cleanText(raw.task),
      site: cleanText(raw.site),
      unitPrice: parseNumericValue(raw.unitPrice, this.config.locale),
      totalPrice: parseNumericValue(raw.totalPrice, this.config.locale),
      category: cleanText(raw.category),
      subcategory: cleanText(raw.subcategory),
      vendor: cleanText(raw.vendor),
      remarks: cleanText(raw.remarks),
      rawData: raw
    };
  }

  /**
   * Validate item and return if valid
   */
  private validateAndReturnItem(
    item: Partial<ParsedBOQItem>,
    rowNum: number
  ): ParsedBOQItem | null {
    const validation = validateBOQItem(item);
    
    if (!validation.valid) {
      validation.errors.forEach(error => {
        this.addError(rowNum, '', item, error, 'validation');
      });
      
      if (this.config.strictValidation) {
        return null;
      }
    }

    return validation.data || (item as ParsedBOQItem);
  }

  /**
   * Update progress callback
   */
  private updateProgress(
    onProgress: ProgressCallback | undefined,
    processedRows: number,
    totalRows: number
  ): void {
    if (onProgress && processedRows % 100 === 0) {
      onProgress(0.9 + (processedRows / totalRows) * 0.1);
    }
  }

  /**
   * Add error to collection
   */
  private addError(
    row: number,
    column: string,
    value: unknown,
    message: string,
    type: ParseError['type']
  ): void {
    const safeValue: string | number | boolean | null | undefined =
      value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? value
        : String(value);
    this.errors.push({ row, column, value: safeValue, message, type });
  }

  /**
   * Reset errors and warnings
   */
  private resetErrors(): void {
    this.errors = [];
    this.warnings = [];
  }

  /**
   * Build processing result
   */
  private buildProcessingResult(
    items: ParsedBOQItem[],
    stats: ProcessingStats
  ) {
    return {
      items,
      stats,
      errors: this.errors,
      warnings: this.warnings
    };
  }
}