/**
 * High-Performance File Import Engine
 * Main orchestrator for large-scale file processing with Web Workers and streaming
 */

import type {
  FileProcessingOptions,
  FileProcessingResult,
  FileType,
  ProcessingStrategy,
  ProcessorConfig,
  ProcessingContext,
} from '../types';

import { ProcessorRouter } from './ProcessorRouter';
import { WorkerManager } from '../workers/WorkerManager';
// import { MemoryManager } from '../memory/MemoryManager';
// import { ProgressTracker } from '../progress/ProgressTracker';
import { FileValidator } from '../validation/FileValidator';

export class FileImportEngine {
  private static instance: FileImportEngine;
  private router: ProcessorRouter;
  private workerManager: WorkerManager;
  // private memoryManager: MemoryManager;
  // private progressTracker: ProgressTracker;
  private validator: FileValidator;
  private activeProcessing: Map<string, ProcessingContext> = new Map();

  private constructor() {
    this.router = new ProcessorRouter();
    this.workerManager = new WorkerManager();
    // this.memoryManager = new MemoryManager();
    // this.progressTracker = new ProgressTracker();
    this.validator = new FileValidator();
  }

  public static getInstance(): FileImportEngine {
    if (!FileImportEngine.instance) {
      FileImportEngine.instance = new FileImportEngine();
    }
    return FileImportEngine.instance;
  }

  /**
   * Main file processing entry point
   */
  public async processFile<T = unknown>(
    file: File,
    options: Partial<FileProcessingOptions> = {}
  ): Promise<FileProcessingResult<T>> {
    const processingId = this.generateProcessingId();
    const context = this.createProcessingContext(processingId, file, options);
    
    try {
      // Store context for tracking
      this.activeProcessing.set(processingId, context);
      
      // Initialize performance tracking
      const startTime = performance.now();
      
      // Validate file
      const validationResult = await this.validator.validateFile(file, options);
      if (!validationResult.isValid) {
        throw new Error(`File validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Detect file type and determine processing strategy
      const fileType = this.detectFileType(file);
      const strategy = this.determineStrategy(file, fileType, options);
      
      // Update context
      context.metadata.type = fileType;
      context.status = 'reading';

      // Route to appropriate processor
      const config: ProcessorConfig = {
        type: fileType,
        strategy,
        options: this.mergeDefaultOptions(options),
        timeoutMs: 300000 // 5 minutes default
      };

      let result: FileProcessingResult<T>;

      switch (strategy) {
        case 'direct':
          result = await this.processDirect<T>(file, config, context);
          break;
        case 'worker':
          result = await this.processWithWorker<T>(file, config, context);
          break;
        case 'streaming':
          result = await this.processStreaming<T>(file, config, context);
          break;
        default:
          throw new Error(`Unsupported processing strategy: ${strategy}`);
      }

      // Calculate performance metrics
      const endTime = performance.now();
      // const metrics = this.calculateMetrics(startTime, endTime, result);
      
      // Update context
      context.endTime = new Date();
      context.status = 'complete';

      // Clean up
      this.cleanup(processingId);

      return {
        ...result,
        processingTime: endTime - startTime,
        strategy
      };

    } catch (error) {
      context.status = 'error';
      this.cleanup(processingId);
      throw error;
    }
  }

  /**
   * Cancel active processing
   */
  public cancelProcessing(processingId: string): boolean {
    const context = this.activeProcessing.get(processingId);
    if (!context) return false;

    if (context.cancellationToken) {
      context.cancellationToken.abort();
    }

    this.cleanup(processingId);
    return true;
  }

  /**
   * Get processing status
   */
  public getProcessingStatus(processingId: string): ProcessingContext | null {
    return this.activeProcessing.get(processingId) || null;
  }

  /**
   * Get all active processing contexts
   */
  public getActiveProcessing(): ProcessingContext[] {
    return Array.from(this.activeProcessing.values());
  }

  private async processDirect<T>(
    file: File,
    config: ProcessorConfig,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const processor = this.router.getProcessor(config.type);
    return processor.process<T>(file, config.options, context);
  }

  private async processWithWorker<T>(
    file: File,
    config: ProcessorConfig,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const worker = await this.workerManager.getWorker();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Processing timeout'));
      }, config.timeoutMs);

      worker.postMessage({
        id: context.fileId,
        type: 'process',
        payload: {
          file,
          config,
          context
        },
        timestamp: new Date()
      });

      const handleMessage = (event: MessageEvent) => {
        const { id, type, payload } = event.data;
        
        if (id !== context.fileId) return;

        switch (type) {
          case 'progress':
            if (config.options.progressCallback) {
              config.options.progressCallback(payload);
            }
            break;
          case 'result':
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            resolve(payload);
            break;
          case 'error':
            clearTimeout(timeout);
            worker.removeEventListener('message', handleMessage);
            reject(new Error(payload.message));
            break;
        }
      };

      worker.addEventListener('message', handleMessage);
    });
  }

  private async processStreaming<T>(
    file: File,
    config: ProcessorConfig,
    context: ProcessingContext
  ): Promise<FileProcessingResult<T>> {
    const processor = this.router.getProcessor(config.type);
    return processor.process<T>(file, config.options, context);
  }

  private detectFileType(file: File): FileType {
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
  }

  private determineStrategy(
    file: File,
    _fileType: FileType,
    options: Partial<FileProcessingOptions>
  ): ProcessingStrategy {
    // Force strategy if specified
    if (options.streaming) return 'streaming';
    if (options.useWebWorker) return 'worker';

    const fileSizeInMB = file.size / (1024 * 1024);

    // Size-based routing
    if (fileSizeInMB > 50) {
      return 'streaming';
    }
    
    if (fileSizeInMB > 5) {
      return 'worker';
    }

    return 'direct';
  }

  private mergeDefaultOptions(options: Partial<FileProcessingOptions>): FileProcessingOptions {
    return {
      maxFileSize: 100 * 1024 * 1024, // 100MB
      chunkSize: 1000,
      useWebWorker: false,
      streaming: false,
      validationRules: [],
      encoding: 'utf-8',
      skipEmptyLines: true,
      trimWhitespace: true,
      ...options
    };
  }

  private createProcessingContext(
    fileId: string,
    file: File,
    options: Partial<FileProcessingOptions>
  ): ProcessingContext {
    return {
      fileId,
      sessionId: this.generateSessionId(),
      metadata: {
        filename: file.name,
        size: file.size,
        type: 'unknown', // Will be detected
        rowCount: 0,
        columnCount: 0,
        headers: [],
        processingStartTime: new Date()
      },
      options: this.mergeDefaultOptions(options),
      startTime: new Date(),
      status: 'initializing',
      cancellationToken: new AbortController()
    };
  }

  // private calculateMetrics(
  //   startTime: number,
  //   endTime: number,
  //   result: FileProcessingResult
  // ): PerformanceMetrics {
  //   const totalTime = endTime - startTime;
  //   
  //   return {
  //     parseTime: totalTime * 0.6, // Rough estimate
  //     validationTime: totalTime * 0.2,
  //     transformTime: totalTime * 0.2,
  //     totalTime,
  //     memoryPeak: result.memoryUsage.peakUsage,
  //     memoryAverage: result.memoryUsage.heapUsed,
  //     gcEvents: result.memoryUsage.gcCount || 0,
  //     rowsPerSecond: result.rowsProcessed / (totalTime / 1000),
  //     bytesPerSecond: result.metadata.size / (totalTime / 1000)
  //   };
  // }

  private cleanup(processingId: string): void {
    this.activeProcessing.delete(processingId);
    // this.memoryManager.cleanup();
  }

  private generateProcessingId(): string {
    return `proc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup and shutdown
   */
  public async shutdown(): Promise<void> {
    // Cancel all active processing
    for (const [_id, context] of this.activeProcessing.entries()) {
      if (context.cancellationToken) {
        context.cancellationToken.abort();
      }
    }
    
    this.activeProcessing.clear();
    
    // Shutdown workers
    await this.workerManager.shutdown();
    
    // Final memory cleanup
    // this.memoryManager.forceCleanup();
  }
}

// Export singleton instance
export const fileImportEngine = FileImportEngine.getInstance();