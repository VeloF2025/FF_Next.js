/**
 * BOQ Import Service
 * Service for managing BOQ imports with job tracking
 */

import { ExcelImportEngine } from './core';
import type { ImportResult, ProgressCallback, ColumnMapping } from './types';

export interface ImportJob {
  id: string;
  boqId: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'parsing' | 'mapping' | 'validating';
  progress: number;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  result?: ImportResult;
  metadata: {
    totalRows: number;
    processedRows: number;
    validRows: number;
    errorRows: number;
  };
}

export interface ImportStats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalItemsProcessed: number;
  totalItemsImported: number;
}

export interface ImportConfig {
  chunkSize?: number;
  columnMapping?: Partial<ColumnMapping>;
  progressCallback?: ProgressCallback;
  // Additional configuration options
  autoApprove?: boolean;
  strictValidation?: boolean;
  createNewItems?: boolean;
  duplicateHandling?: 'skip' | 'replace' | 'merge';
  minMappingConfidence?: number;
}

export class BOQImportService {
  private jobs: Map<string, ImportJob> = new Map();

  /**
   * Start a new BOQ import job
   */
  async startImport(
    boqId: string,
    file: File,
    config?: ImportConfig
  ): Promise<ImportJob> {
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const job: ImportJob = {
      id: jobId,
      boqId,
      fileName: file.name,
      status: 'pending',
      progress: 0,
      startedAt: new Date(),
      metadata: {
        totalRows: 0,
        processedRows: 0,
        validRows: 0,
        errorRows: 0
      }
    };

    this.jobs.set(jobId, job);

    // Start processing
    this.processImport(job, file, config);

    return job;
  }

  /**
   * Get import statistics
   */
  getImportStats(): ImportStats {
    const jobs = Array.from(this.jobs.values());
    
    return {
      totalJobs: jobs.length,
      activeJobs: jobs.filter(j => j.status === 'processing').length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      totalItemsProcessed: jobs.reduce((total, job) => total + job.metadata.validRows, 0),
      totalItemsImported: jobs.reduce((total, job) => total + job.metadata.validRows, 0)
    };
  }

  /**
   * Get active import jobs
   */
  getActiveJobs(): ImportJob[] {
    return Array.from(this.jobs.values()).filter(job => 
      job.status === 'pending' || job.status === 'processing'
    );
  }

  /**
   * Cancel an import job
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job && (job.status === 'pending' || job.status === 'processing')) {
      job.status = 'failed';
      job.error = 'Cancelled by user';
      job.completedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Get job by ID
   */
  getJob(jobId: string): ImportJob | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Process the import
   */
  private async processImport(
    job: ImportJob,
    file: File,
    config?: ImportConfig
  ): Promise<void> {
    try {
      job.status = 'processing';

      const progressCallback: ProgressCallback = (progress) => {
        job.progress = progress.progress;
        job.metadata.totalRows = progress.totalRows;
        job.metadata.processedRows = progress.processedRows;
        // Update job in the map
        this.jobs.set(job.id, { ...job });
        
        // Call user's progress callback if provided
        if (config?.progressCallback) {
          config.progressCallback(progress);
        }
      };

      const engine = new ExcelImportEngine(progressCallback, config?.columnMapping);
      
      const result: ImportResult = config?.chunkSize 
        ? await engine.parseFileInChunks(file, config.chunkSize)
        : await engine.parseFile(file);

      // Update job with results
      job.status = result.success ? 'completed' : 'failed';
      job.progress = 100;
      job.completedAt = new Date();
      job.result = result;
      job.metadata.validRows = result.stats.validRows;
      job.metadata.errorRows = result.stats.errorRows;
      
      if (!result.success && result.errors.length > 0) {
        job.error = result.errors[0]!.message;
      }

      this.jobs.set(job.id, job);

    } catch (error) {
      job.status = 'failed';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();
      this.jobs.set(job.id, job);
    }
  }
}