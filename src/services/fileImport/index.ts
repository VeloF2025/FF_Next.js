/**
 * High-Performance File Import System
 * Export all components for easy integration
 */

// Main engine
export { FileImportEngine, fileImportEngine } from './engine/FileImportEngine';
export { ProcessorRouter } from './engine/ProcessorRouter';

// Processors
export { EnhancedCSVProcessor } from './processors/EnhancedCSVProcessor';
export { EnhancedExcelProcessor } from './processors/EnhancedExcelProcessor';

// Supporting components
export { WorkerManager } from './workers/WorkerManager';
export { FileValidator } from './validation/FileValidator';
export { MemoryManager } from './memory/MemoryManager';
export { ProgressTracker } from './progress/ProgressTracker';

// Types
export type * from './types/index';
import type { FileProcessingProgress, ProcessingError } from './types/index';

// Utility functions
export const FileImportUtils = {
  /**
   * Quick file processing with default options
   */
  async processFile<T = unknown>(
    file: File,
    options: {
      onProgress?: (progress: number) => void;
      onError?: (error: string) => void;
      maxFileSize?: number;
      useStreaming?: boolean;
    } = {}
  ) {
    const { fileImportEngine } = await import('./engine/FileImportEngine');
    
    return fileImportEngine.processFile<T>(file, {
      maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
      streaming: options.useStreaming || false,
      ...(options.onProgress ? { progressCallback: (progress: FileProcessingProgress) => {
        options.onProgress!(progress.percentage);
      } } : {}),
      ...(options.onError ? { onError: (error: ProcessingError) => {
        options.onError!(error.message);
      } } : {}),
      validationRules: [],
      chunkSize: 1000,
      useWebWorker: false
    });
  },

  /**
   * Validate file before processing
   */
  async validateFile(file: File, options: { maxFileSize?: number } = {}) {
    const { FileValidator } = await import('./validation/FileValidator');
    const validator = new FileValidator();
    
    return validator.validateFile(file, {
      maxFileSize: options.maxFileSize || 100 * 1024 * 1024,
      validationRules: [],
      chunkSize: 1000,
      useWebWorker: false,
      streaming: false
    });
  },

  /**
   * Get memory requirements estimate
   */
  estimateMemoryUsage(file: File): number {
    const extension = file.name.toLowerCase().split('.').pop() || '';
    const multipliers: Record<string, number> = {
      csv: 3,
      xlsx: 5,
      xls: 4
    };
    
    return file.size * (multipliers[extension] || 3);
  },

  /**
   * Format file size for display
   */
  formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  },

  /**
   * Detect file type from file object
   */
  detectFileType(file: File): 'csv' | 'xlsx' | 'xls' | 'unknown' {
    const extension = file.name.toLowerCase().split('.').pop() || '';
    const mimeType = file.type.toLowerCase();

    if (extension === 'csv' || mimeType.includes('csv')) {
      return 'csv';
    }
    
    if (extension === 'xlsx' || mimeType.includes('spreadsheetml')) {
      return 'xlsx';
    }
    
    if (extension === 'xls' || mimeType.includes('excel')) {
      return 'xls';
    }

    return 'unknown';
  },

  /**
   * Get processing strategy recommendation
   */
  getRecommendedStrategy(
    file: File,
    options: { preferSpeed?: boolean; memoryConstrained?: boolean } = {}
  ): 'direct' | 'worker' | 'streaming' {
    const fileSizeInMB = file.size / (1024 * 1024);
    const fileType = this.detectFileType(file);

    // Memory constrained mode
    if (options.memoryConstrained) {
      if (fileSizeInMB > 10) return 'streaming';
      if (fileSizeInMB > 2) return 'worker';
      return 'direct';
    }

    // Speed prioritized mode
    if (options.preferSpeed) {
      if (fileSizeInMB > 25) return 'streaming';
      if (fileSizeInMB > 3) return 'worker';
      return 'direct';
    }

    // Balanced mode (default)
    if (fileType === 'csv') {
      if (fileSizeInMB > 50) return 'streaming';
      if (fileSizeInMB > 10) return 'worker';
      return 'direct';
    } else { // Excel files
      if (fileSizeInMB > 25) return 'streaming';
      if (fileSizeInMB > 5) return 'worker';
      return 'direct';
    }
  }
};

// Performance benchmarking utility
export const FileImportBenchmark = {
  /**
   * Benchmark file processing performance
   */
  async benchmark(
    file: File,
    strategies: Array<'direct' | 'worker' | 'streaming'> = ['direct', 'worker', 'streaming']
  ) {
    const results: Array<{
      strategy: string;
      processingTime: number;
      memoryPeak: number;
      rowsPerSecond: number;
      success: boolean;
      error?: string;
    }> = [];

    for (const strategy of strategies) {
      try {
        const startTime = performance.now();
        const startMemory = this.getMemoryUsage();
        
        const result = await FileImportUtils.processFile(file, {
          useStreaming: strategy === 'streaming',
          // useWebWorker: strategy === 'worker' // Would need worker implementation
        });

        const endTime = performance.now();
        const endMemory = this.getMemoryUsage();
        
        results.push({
          strategy,
          processingTime: endTime - startTime,
          memoryPeak: Math.max(startMemory, endMemory),
          rowsPerSecond: result.rowsProcessed / ((endTime - startTime) / 1000),
          success: true
        });

      } catch (error) {
        results.push({
          strategy,
          processingTime: 0,
          memoryPeak: 0,
          rowsPerSecond: 0,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      file: {
        name: file.name,
        size: file.size,
        type: FileImportUtils.detectFileType(file)
      },
      results,
      recommendation: this.getBenchmarkRecommendation(results)
    };
  },

  getMemoryUsage(): number {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in performance) {
      const memory = (performance as { memory: { usedJSHeapSize: number } }).memory;
      return memory.usedJSHeapSize;
    }
    return 0;
  },

  getBenchmarkRecommendation(results: Array<{ strategy: string; processingTime: number; memoryPeak: number; success: boolean }>): string {
    const successful = results.filter(r => r.success);
    if (successful.length === 0) return 'No successful strategies';

    const fastest = successful.reduce((prev, curr) => 
      prev.processingTime < curr.processingTime ? prev : curr
    );

    const mostEfficient = successful.reduce((prev, curr) => 
      prev.memoryPeak < curr.memoryPeak ? prev : curr
    );

    if (fastest.strategy === mostEfficient.strategy) {
      return `${fastest.strategy} - Best overall (fastest and most memory efficient)`;
    }

    return `${fastest.strategy} for speed, ${mostEfficient.strategy} for memory efficiency`;
  }
};