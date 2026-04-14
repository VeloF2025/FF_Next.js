/**
 * Enhanced High-Performance CSV Processor
 * Uses PapaParse with Web Workers and streaming for large files
 */

import Papa from 'papaparse';
import type {
  FileProcessingOptions,
  FileProcessingResult,
  ProcessingContext,
  CSVProcessingOptions,
  FileMetadata,
  ProcessingError,
  ProcessingWarning,
  MemoryStats,
  DetectedFormat
} from '../types';

/** Browser performance.memory extension (Chrome/Chromium only) */
type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

/** Window extension for optional GC access (V8 --expose-gc flag) */
type WindowWithGC = Window & { gc?: () => void };

export class EnhancedCSVProcessor {
  // private readonly CHUNK_SIZE = 8192; // 8KB chunks for streaming
  private readonly MAX_DIRECT_SIZE = 5 * 1024 * 1024; // 5MB

  /**
   * Process CSV file with automatic strategy selection
   */
  public async process<T = unknown>(
    file: File,
    options: FileProcessingOptions,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const csvOptions = options as CSVProcessingOptions;

    // Update context
    context.status = 'parsing';

    if (file.size > this.MAX_DIRECT_SIZE || options.streaming) {
      return this.processStreaming<T>(file, csvOptions, context);
    } else {
      return this.processDirect<T>(file, csvOptions, context);
    }
  }

  /**
   * Direct processing for smaller files
   */
  private async processDirect<T>(
    file: File,
    options: CSVProcessingOptions,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const errors: ProcessingError[] = [];
      const warnings: ProcessingWarning[] = [];

      Papa.parse<T>(file, {
        header: true,
        delimiter: options.delimiter || '',
        quoteChar: options.quote || '"',
        escapeChar: options.escape || '"',
        comments: (options.comment || false) as string | false,
        skipEmptyLines: options.skipEmptyLines ?? true,
        dynamicTyping: options.dynamicTyping ?? true,
        transform: options.transform,
        transformHeader: (header: string) => {
          return options.trimWhitespace ? header.trim() : header;
        },
        beforeFirstChunk: (chunk: string) => {
          if (options.skipLinesBeginning) {
            const lines = chunk.split('\n');
            return lines.slice(options.skipLinesBeginning).join('\n');
          }
          return chunk;
        },
        step: (results: Papa.ParseStepResult<T>) => {
          // Progress callback
          if (options.progressCallback) {
            const progress = {
              processedRows: results.meta.cursor || 0,
              totalRows: Math.ceil(file.size / 50), // Rough estimate
              percentage: Math.min(((results.meta.cursor || 0) / file.size) * 100, 100),
              estimatedTimeRemaining: 0,
              currentPhase: 'parsing' as const,
              bytesProcessed: results.meta.cursor || 0,
              totalBytes: file.size,
              memoryUsage: this.getMemoryStats()
            };

            options.progressCallback(progress);
          }

          // Handle errors
          if (results.errors && results.errors.length > 0) {
            for (const error of results.errors) {
              const processingError: ProcessingError = {
                type: 'parsing',
                severity: error.type === 'Quotes' ? 'high' : 'medium',
                message: error.message,
                details: `Code: ${error.code}`,
                row: error.row || 0,
                ...(error.code === 'UndetectableDelimiter' ? {} : { column: String(error.row) }),
                code: error.code,
                timestamp: new Date(),
                recoverable: error.type !== 'Quotes'
              };
              errors.push(processingError);
            }
          }
        },
        complete: (results: Papa.ParseResult<T>) => {
          const endTime = performance.now();

          // Validation
          context.status = 'validating';
          const validationResults = this.validateData(results.data, options);
          errors.push(...validationResults.errors);
          warnings.push(...validationResults.warnings);

          // Create metadata
          const metadata: FileMetadata = {
            ...context.metadata,
            rowCount: results.data.length,
            columnCount: results.meta.fields?.length || 0,
            headers: results.meta.fields || [],
            detectedFormat: {
              delimiter: results.meta.delimiter,
              hasHeaders: true,
              lineTerminator: results.meta.linebreak
            } as DetectedFormat,
            processingEndTime: new Date()
          };

          const result: FileProcessingResult<T> = {
            data: results.data,
            metadata,
            errors,
            warnings,
            processingTime: endTime - startTime,
            memoryUsage: this.getMemoryStats(),
            rowsProcessed: results.data.length,
            rowsSkipped: errors.filter(e => e.type === 'parsing').length,
            isPartial: errors.some(e => e.severity === 'critical'),
            strategy: 'direct'
          };

          resolve(result);
        },
        error: (error: Error) => {
          const processingError = new Error(`CSV parsing failed: ${error.message}`);
          reject(processingError);
        }
      });
    });
  }

  /**
   * Streaming processing for large files
   */
  public async processStreaming<T>(
    file: File,
    options: CSVProcessingOptions,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    return new Promise((resolve, reject) => {
      const startTime = performance.now();
      const errors: ProcessingError[] = [];
      const warnings: ProcessingWarning[] = [];
      const data: T[] = [];
      let headers: string[] = [];
      let processedRows = 0;
      let bytesProcessed = 0;
      let isFirstChunk = true;

      // Papa.parse with NODE_STREAM_INPUT returns a Node.js Duplex stream
      const stream = Papa.parse(Papa.NODE_STREAM_INPUT, {
        header: true,
        delimiter: options.delimiter || '',
        quoteChar: options.quote || '"',
        escapeChar: options.escape || '"',
        skipEmptyLines: options.skipEmptyLines ?? true,
        dynamicTyping: options.dynamicTyping ?? true,
        transform: options.transform,
        transformHeader: (header: string) => {
          return options.trimWhitespace ? header.trim() : header;
        },
        step: (results: Papa.ParseStepResult<T>) => {
          if (isFirstChunk && results.meta.fields) {
            headers = results.meta.fields;
            isFirstChunk = false;
          }

          // Add valid rows to data
          if (results.data && !results.errors.length) {
            const row = results.data;
            data.push(row);
            processedRows += 1;
          }

          // Handle errors
          if (results.errors && results.errors.length > 0) {
            for (const error of results.errors) {
              errors.push({
                type: 'parsing',
                severity: error.type === 'Quotes' ? 'high' : 'medium',
                message: error.message,
                details: `Code: ${error.code}`,
                row: error.row ?? processedRows,
                column: String(error.row ?? processedRows),
                code: error.code,
                timestamp: new Date(),
                recoverable: true
              });
            }
          }

          // Update progress
          bytesProcessed = results.meta.cursor || bytesProcessed;
          if (options.progressCallback) {
            const progress = {
              processedRows,
              totalRows: Math.ceil(file.size / 50), // Estimate
              percentage: Math.min((bytesProcessed / file.size) * 100, 100),
              estimatedTimeRemaining: this.estimateTimeRemaining(
                startTime,
                bytesProcessed,
                file.size
              ),
              currentPhase: 'parsing' as const,
              bytesProcessed,
              totalBytes: file.size,
              memoryUsage: this.getMemoryStats()
            };

            options.progressCallback(progress);
          }

          // Memory management
          if (this.shouldTriggerGC(data.length)) {
            this.triggerGarbageCollection();
          }
        },
        complete: () => {
          const endTime = performance.now();

          // Final validation
          context.status = 'validating';
          const validationResults = this.validateData(data, options);
          errors.push(...validationResults.errors);
          warnings.push(...validationResults.warnings);

          // Create metadata
          const metadata: FileMetadata = {
            ...context.metadata,
            rowCount: data.length,
            columnCount: headers.length,
            headers,
            detectedFormat: {
              delimiter: options.delimiter || ',',
              hasHeaders: true
            } as DetectedFormat,
            processingEndTime: new Date()
          };

          const result: FileProcessingResult<T> = {
            data,
            metadata,
            errors,
            warnings,
            processingTime: endTime - startTime,
            memoryUsage: this.getMemoryStats(),
            rowsProcessed: data.length,
            rowsSkipped: errors.filter(e => e.type === 'parsing').length,
            isPartial: false,
            strategy: 'streaming'
          };

          context.status = 'complete';
          resolve(result);
        },
        error: (error: Error) => {
          reject(new Error(`Streaming CSV parsing failed: ${error.message}`));
        }
      } as Papa.ParseConfig);

      // Start streaming — stream is a Node.js Duplex returned by Papa with NODE_STREAM_INPUT
      const reader = file.stream().getReader();
      const decoder = new TextDecoder(options.encoding || 'utf-8');

      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();

        if (done) {
          // Stream processing complete
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        // Write chunk to PapaParse node stream (Duplex guarantees .write())
        stream.write(chunk);

        return pump();
      };

      pump().catch(reject);
    });
  }

  /**
   * Validate parsed data
   */
  private validateData<T>(
    data: T[],
    options: CSVProcessingOptions
  ): { errors: ProcessingError[]; warnings: ProcessingWarning[] } {
    const errors: ProcessingError[] = [];
    const warnings: ProcessingWarning[] = [];

    if (!options.validationRules || options.validationRules.length === 0) {
      return { errors, warnings };
    }

    for (let i = 0; i < data.length; i++) {
      const row = data[i] as Record<string, unknown>;

      for (const rule of options.validationRules) {
        const result = rule.validator(row[rule.field], row);

        if (!result.isValid) {
          const error: ProcessingError = {
            type: 'validation',
            severity: rule.severity === 'error' ? 'high' : 'medium',
            message: result.message || rule.message || `Validation failed for field: ${rule.field}`,
            details: result.suggestion || 'No suggestion provided',
            row: i + 1,
            column: rule.field,
            timestamp: new Date(),
            recoverable: rule.severity !== 'error'
          };

          if (rule.severity === 'error') {
            errors.push(error);
          } else {
            warnings.push({
              type: 'data',
              message: error.message,
              timestamp: error.timestamp,
              ...(error.details && { suggestion: error.details }),
              ...(error.row && { row: error.row }),
              ...(error.column && { column: error.column })
            });
          }
        }
      }
    }

    return { errors, warnings };
  }

  private getMemoryStats(): MemoryStats {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in performance) {
      const perf = performance as PerformanceWithMemory;
      if (perf.memory) {
        return {
          heapUsed: perf.memory.usedJSHeapSize,
          heapTotal: perf.memory.totalJSHeapSize,
          external: 0,
          peakUsage: perf.memory.totalJSHeapSize
        };
      }
    }

    // Fallback for environments without memory API
    return {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      peakUsage: 0
    };
  }

  private estimateTimeRemaining(
    startTime: number,
    bytesProcessed: number,
    totalBytes: number
  ): number {
    if (bytesProcessed === 0) return 0;

    const elapsedTime = performance.now() - startTime;
    const processingRate = bytesProcessed / elapsedTime; // bytes per ms
    const remainingBytes = totalBytes - bytesProcessed;

    return remainingBytes / processingRate;
  }

  private shouldTriggerGC(processedRows: number): boolean {
    // Trigger GC every 10,000 rows or when memory usage is high
    return processedRows % 10000 === 0 || this.isMemoryHigh();
  }

  private isMemoryHigh(): boolean {
    const stats = this.getMemoryStats();
    return stats.heapUsed > 0 && (stats.heapUsed / stats.heapTotal) > 0.8;
  }

  private triggerGarbageCollection(): void {
    // Force garbage collection if available (V8 --expose-gc flag only)
    if (typeof window !== 'undefined') {
      const win = window as WindowWithGC;
      win.gc?.();
    }
  }
}
