/**
 * Import Engine - File Processing Strategies
 * Different approaches for processing files (standard vs chunked)
 */

import { 
  ImportResult, 
  ProcessingOptions, 
  ProcessingContext,
  ColumnMapping 
} from './types';
import { readFile } from '../fileParsing';
import { detectColumnMapping } from '../columnMapping';
import { DataProcessor } from './dataProcessor';
import { ProgressManager } from './progressManager';

export class FileProcessor {
  private dataProcessor: DataProcessor;
  private progressManager: ProgressManager;

  constructor(progressManager: ProgressManager) {
    this.dataProcessor = new DataProcessor();
    this.progressManager = progressManager;
  }

  /**
   * Process file using standard approach (all at once)
   */
  async processFileStandard(
    file: File,
    columnMapping: ColumnMapping,
    options: ProcessingOptions = {}
  ): Promise<ImportResult> {
    const result = this.initializeResult();

    try {
      // Read file
      const rawData = await this.readAndValidateFile(file);
      
      // Auto-detect column mapping if needed
      const finalMapping = await this.detectAndUpdateMapping(rawData, columnMapping, result);
      
      // Process all rows
      const context = this.initializeContext(rawData.length, finalMapping);
      await this.processAllRows(rawData, context);
      
      // Finalize result
      return this.finalizeResult(result, context, options);

    } catch (error) {
      return this.handleProcessingError(error, result);
    }
  }

  /**
   * Process file in chunks for large files
   */
  async processFileChunked(
    file: File,
    columnMapping: ColumnMapping,
    chunkSize: number = 1000,
    options: ProcessingOptions = {}
  ): Promise<ImportResult> {
    const result = this.initializeResult();

    try {
      // Read file
      const rawData = await this.readAndValidateFile(file);
      
      // Auto-detect column mapping if needed
      const finalMapping = await this.detectAndUpdateMapping(rawData, columnMapping, result);
      
      // Process in chunks
      const context = this.initializeContext(rawData.length, finalMapping);
      await this.processInChunks(rawData, context, chunkSize);
      
      // Finalize result
      return this.finalizeResult(result, context, options);

    } catch (error) {
      return this.handleProcessingError(error, result);
    }
  }

  /**
   * Read and validate file data
   */
  private async readAndValidateFile(file: File): Promise<Record<string, unknown>[]> {
    this.progressManager.updateProgress(
      this.progressManager.createParsingProgress(0, 0, 0, 'Reading file...')
    );

    const rawData = await readFile(file);
    
    this.progressManager.updateProgress(
      this.progressManager.createParsingProgress(
        25, 0, rawData.length, `Parsed ${rawData.length} rows from file`
      )
    );

    if (rawData.length === 0) {
      throw new Error('File is empty or contains no valid data');
    }

    return rawData;
  }

  /**
   * Detect and update column mapping
   */
  private async detectAndUpdateMapping(
    rawData: Record<string, unknown>[],
    columnMapping: ColumnMapping,
    result: ImportResult
  ): Promise<ColumnMapping> {
    const headers = Object.keys(rawData[0] || {});
    if (headers.length === 0) {
      throw new Error('No columns detected in file');
    }

    const detectionResult = detectColumnMapping(headers);
    if (detectionResult.confidence < 0.3) {
      result.warnings.push({
        type: 'mapping',
        row: 0,
        message: `Low confidence (${(detectionResult.confidence * 100).toFixed(1)}%) in automatic column detection`,
        suggestion: 'Consider manually reviewing column mappings'
      });
    }

    return { ...columnMapping, ...detectionResult.mapping } as ColumnMapping;
  }

  /**
   * Process all rows at once
   */
  private async processAllRows(
    rawData: Record<string, unknown>[],
    context: ProcessingContext
  ): Promise<void> {
    this.progressManager.updateProgress(
      this.progressManager.createValidationProgress(
        30, 0, rawData.length, 'Validating and mapping data...'
      )
    );

    const chunkResult = this.dataProcessor.processRows(rawData, 0, context.columnMapping);
    this.dataProcessor.updateContextWithResults(context, chunkResult);

    this.progressManager.updateProgress(
      this.progressManager.createProcessingProgress(
        80, rawData.length, rawData.length, `Processed ${rawData.length} rows`
      )
    );
  }

  /**
   * Process data in chunks
   */
  private async processInChunks(
    rawData: Record<string, unknown>[],
    context: ProcessingContext,
    chunkSize: number
  ): Promise<void> {
    const totalChunks = Math.ceil(rawData.length / chunkSize);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startIndex = chunkIndex * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, rawData.length);
      const chunk = rawData.slice(startIndex, endIndex);

      const chunkResult = this.dataProcessor.processRows(chunk, startIndex, context.columnMapping);
      this.dataProcessor.updateContextWithResults(context, chunkResult);

      // Update progress after each chunk
      const progress = (context.processedRows / rawData.length) * 80; // Up to 80%
      this.progressManager.updateProgress(
        this.progressManager.createProcessingProgress(
          20 + progress,
          context.processedRows,
          rawData.length,
          `Processed ${context.processedRows} of ${rawData.length} rows (${Math.round(progress)}%)`,
          context.errors,
          context.warnings
        )
      );

      // Allow UI to update between chunks
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  }

  /**
   * Initialize empty result structure
   */
  private initializeResult(): ImportResult {
    return {
      success: false,
      data: [],
      errors: [],
      warnings: [],
      stats: {
        totalRows: 0,
        validRows: 0,
        errorRows: 0,
        warningRows: 0
      }
    };
  }

  /**
   * Initialize processing context
   */
  private initializeContext(totalRows: number, columnMapping: ColumnMapping): ProcessingContext {
    return {
      totalRows,
      processedRows: 0,
      validItems: [],
      errors: [],
      warnings: [],
      columnMapping
    };
  }

  /**
   * Finalize processing result
   */
  private finalizeResult(
    result: ImportResult,
    context: ProcessingContext,
    options: ProcessingOptions
  ): ImportResult {
    result.data = context.validItems;
    result.errors = context.errors;
    result.warnings = context.warnings;
    result.stats.totalRows = context.totalRows;

    // Perform consistency validation if not skipped
    if (!options.skipConsistencyCheck) {
      this.progressManager.updateProgress(
        this.progressManager.createProcessingProgress(
          85, context.totalRows, context.totalRows, 'Performing data consistency checks...',
          context.errors, context.warnings
        )
      );

      const consistencyCheck = this.dataProcessor.validateConsistency(context.validItems);
      result.errors.push(...consistencyCheck.errors);
      result.warnings.push(...consistencyCheck.warnings);
    }

    // Update final statistics
    const stats = this.dataProcessor.calculateStats(result.errors, result.warnings);
    result.stats.errorRows = stats.errorRows;
    result.stats.warningRows = stats.warningRows;
    result.stats.validRows = context.totalRows - stats.errorRows;

    result.success = this.dataProcessor.isProcessingSuccessful(result.data.length, result.errors.length);

    this.progressManager.updateProgress(
      this.progressManager.createCompleteProgress(
        context.totalRows,
        result.success 
          ? `Successfully processed ${result.data.length} items`
          : `Completed with ${result.errors.length} errors and ${result.warnings.length} warnings`,
        result.errors,
        result.warnings
      )
    );

    return result;
  }

  /**
   * Handle processing errors
   */
  private handleProcessingError(error: unknown, result: ImportResult): ImportResult {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    result.errors.push({
      type: 'system',
      row: 0,
      message: errorMessage
    });

    this.progressManager.updateProgress(
      this.progressManager.createErrorProgress(
        `Import failed: ${errorMessage}`,
        result.errors,
        result.warnings
      )
    );

    return result;
  }
}