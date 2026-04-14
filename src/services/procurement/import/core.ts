/**
 * Excel Import Engine - Core Implementation
 * Main processing engine with progress tracking
 */

import type { 
  ImportResult, 
  ProgressCallback, 
  ColumnMapping,
  ParsedBOQItem
} from './importTypes';
import { readFile } from './fileParsing';
import { validateDataConsistency } from './importValidation';
import { ProgressTracker } from './progressTracker';
import { RowProcessor } from './rowProcessor';
import { ColumnManager } from './columnManager';
import { ChunkProcessor } from './chunkProcessor';

/**
 * Main Excel Import Engine for BOQ files
 * Supports streaming processing for large files with progress tracking
 */
export class ExcelImportEngine {
  private progressTracker: ProgressTracker;
  private columnManager: ColumnManager;
  private rowProcessor = new RowProcessor();
  private chunkProcessor: ChunkProcessor;

  constructor(
    progressCallback?: ProgressCallback,
    customColumnMapping?: Partial<ColumnMapping>
  ) {
    this.progressTracker = new ProgressTracker(progressCallback);
    this.columnManager = new ColumnManager(customColumnMapping);
    this.chunkProcessor = new ChunkProcessor(this.progressTracker);
  }

  /**
   * Parse Excel or CSV file and return structured BOQ data
   */
  async parseFile(file: File): Promise<ImportResult> {
    const result: ImportResult = {
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

    try {
      this.progressTracker.updateProgress(
        this.progressTracker.createParsingProgress(0, 0, 0, 'Reading file...')
      );

      // Read file based on type
      const rawData = await readFile(file);
      
      this.progressTracker.updateProgress(
        this.progressTracker.createParsingProgress(25, 0, rawData.length, `Parsed ${rawData.length} rows from file`)
      );

      if (rawData.length === 0) {
        throw new Error('File is empty or contains no valid data');
      }

      // Auto-detect column mapping
      const headers = Object.keys(rawData[0] || {});
      const mappingResult = this.columnManager.detectMapping(headers);
      result.warnings.push(...mappingResult.warnings);

      this.progressTracker.updateProgress(
        this.progressTracker.createValidationProgress(30, 0, rawData.length, 'Validating and mapping data...', [], result.warnings)
      );

      // Process each row
      const validItems: ParsedBOQItem[] = [];
      let processedRows = 0;

      for (let i = 0; i < rawData.length; i++) {
        const rowResult = this.rowProcessor.processRow(rawData[i]!, i, this.columnManager.getColumnMapping());

        if (rowResult.item) {
          validItems.push(rowResult.item);
        }

        result.errors.push(...rowResult.errors);
        result.warnings.push(...rowResult.warnings);

        // Update statistics
        if (rowResult.errors.length > 0) {
          result.stats.errorRows++;
        } else if (rowResult.warnings.length > 0) {
          result.stats.warningRows++;
        } else {
          result.stats.validRows++;
        }

        processedRows++;

        // Update progress periodically
        if (processedRows % 100 === 0 || processedRows === rawData.length) {
          const progress = 30 + (processedRows / rawData.length) * 50; // 30-80%
          this.progressTracker.updateProgress(
            this.progressTracker.createProcessingProgress(progress, processedRows, rawData.length, `Processed ${processedRows} of ${rawData.length} rows`, result.errors, result.warnings)
          );
        }
      }

      result.stats.totalRows = rawData.length;
      result.data = validItems;

      // Perform cross-validation
      this.progressTracker.updateProgress(
        this.progressTracker.createProcessingProgress(85, rawData.length, rawData.length, 'Performing data consistency checks...', result.errors, result.warnings)
      );

      const consistencyCheck = validateDataConsistency(validItems);
      result.errors.push(...consistencyCheck.errors);
      result.warnings.push(...consistencyCheck.warnings);

      // Update final statistics
      this.rowProcessor.updateResultStats(result);
      
      result.success = result.data.length > 0 && result.errors.length === 0;

      this.progressTracker.updateProgress(
        this.progressTracker.createCompleteProgress(rawData.length, rawData.length, result.success 
          ? `Successfully processed ${result.data.length} items`
          : `Completed with ${result.errors.length} errors and ${result.warnings.length} warnings`, result.errors, result.warnings)
      );

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      result.errors.push({
        type: 'system',
        row: 0,
        message: errorMessage
      });

      this.progressTracker.updateProgress(
        this.progressTracker.createErrorProgress(`Import failed: ${errorMessage}`, result.errors, result.warnings)
      );

      return result;
    }
  }

  /**
   * Set custom column mapping
   */
  setColumnMapping(mapping: Partial<ColumnMapping>): void {
    this.columnManager.setColumnMapping(mapping);
  }

  /**
   * Get current column mapping
   */
  getColumnMapping(): ColumnMapping {
    return this.columnManager.getColumnMapping();
  }

  /**
   * Process file in chunks for better memory management
   */
  async parseFileInChunks(file: File, chunkSize: number = 1000): Promise<ImportResult> {
    try {
      // Read file
      const rawData = await readFile(file);

      if (rawData.length === 0) {
        throw new Error('File is empty or contains no valid data');
      }

      // Auto-detect column mapping
      const headers = Object.keys(rawData[0] || {});
      const mappingResult = this.columnManager.detectMapping(headers);

      // Process in chunks
      const result = await this.chunkProcessor.processInChunks(rawData, this.columnManager.getColumnMapping(), chunkSize);
      
      // Add mapping warnings to result
      result.warnings.unshift(...mappingResult.warnings);
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      const result: ImportResult = {
        success: false,
        data: [],
        errors: [{
          type: 'system',
          row: 0,
          message: errorMessage
        }],
        warnings: [],
        stats: {
          totalRows: 0,
          validRows: 0,
          errorRows: 0,
          warningRows: 0
        }
      };

      this.progressTracker.updateProgress(
        this.progressTracker.createErrorProgress(`Import failed: ${errorMessage}`, result.errors, result.warnings)
      );

      return result;
    }
  }
}