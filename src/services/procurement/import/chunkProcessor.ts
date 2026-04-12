/**
 * Chunk Processor
 * Handles chunked processing for large files
 */

import type { 
  ImportResult, 
  ColumnMapping 
} from './importTypes';
import { RowProcessor } from './rowProcessor';
import { ProgressTracker } from './progressTracker';
import { validateDataConsistency } from './importValidation';

export class ChunkProcessor {
  private rowProcessor = new RowProcessor();
  private progressTracker: ProgressTracker;

  constructor(progressTracker: ProgressTracker) {
    this.progressTracker = progressTracker;
  }

  /**
   * Process file in chunks for better memory management
   */
  async processInChunks(
    rawData: Record<string, unknown>[],
    columnMapping: ColumnMapping,
    chunkSize: number = 1000
  ): Promise<ImportResult> {
    const result: ImportResult = {
      success: false,
      data: [],
      errors: [],
      warnings: [],
      stats: {
        totalRows: rawData.length,
        validRows: 0,
        errorRows: 0,
        warningRows: 0
      }
    };

    if (rawData.length === 0) {
      throw new Error('File is empty or contains no valid data');
    }

    // Process in chunks
    const totalChunks = Math.ceil(rawData.length / chunkSize);
    let processedRows = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startIndex = chunkIndex * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, rawData.length);
      const chunk = rawData.slice(startIndex, endIndex);

      // Process chunk
      const chunkResult = this.rowProcessor.processBatch(chunk, startIndex, columnMapping);
      
      // Add results
      result.data.push(...chunkResult.validItems);
      result.errors.push(...chunkResult.errors);
      result.warnings.push(...chunkResult.warnings);
      
      // Update statistics
      result.stats.validRows += chunkResult.stats.validRows;
      result.stats.errorRows += chunkResult.stats.errorRows;
      result.stats.warningRows += chunkResult.stats.warningRows;

      processedRows = endIndex;

      // Update progress after each chunk
      const progress = (processedRows / rawData.length) * 100;
      this.progressTracker.updateProgress(
        this.progressTracker.createProcessingProgress(
          progress,
          processedRows,
          rawData.length,
          `Processed ${processedRows} of ${rawData.length} rows (${Math.round(progress)}%)`,
          result.errors,
          result.warnings
        )
      );

      // Allow UI to update between chunks
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    // Final validation
    const consistencyCheck = validateDataConsistency(result.data);
    result.errors.push(...consistencyCheck.errors);
    result.warnings.push(...consistencyCheck.warnings);

    // Update final statistics
    this.rowProcessor.updateResultStats(result);
    
    result.success = result.data.length > 0 && result.errors.length === 0;

    this.progressTracker.updateProgress(
      this.progressTracker.createCompleteProgress(
        rawData.length,
        rawData.length,
        `Completed: ${result.data.length} items processed`,
        result.errors,
        result.warnings
      )
    );

    return result;
  }
}