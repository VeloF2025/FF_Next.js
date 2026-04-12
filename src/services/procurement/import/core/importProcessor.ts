/**
 * BOQ Import Processor
 * Main import processing logic and workflow orchestration
 */

import { parseFile, validateFile } from '../../../../lib/utils/excelParser';
import { ParsedBOQItem } from '../../../../lib/utils/excelParser';
import { ProcurementContext } from '../../../../types/procurement/base.types';
import {
  ImportJob,
  ImportConfig,
  ProgressCallback,
  IImportProcessor,
  MappingResults
} from './types';
import { BOQImportJobManager } from './jobManager';
import { BOQImportDataProcessor } from './dataProcessor';
import { BOQImportDatabaseSaver } from './databaseSaver';

/** Extends ImportJob with temporary pipeline-stage data (never persisted) */
interface ProcessingJob extends ImportJob {
  parsedItems: ParsedBOQItem[];
  validItems: ParsedBOQItem[];
  mappingResults: MappingResults;
}

export class BOQImportProcessor implements IImportProcessor {
  private jobManager: BOQImportJobManager;
  private dataProcessor: BOQImportDataProcessor;
  private databaseSaver: BOQImportDatabaseSaver;

  constructor(
    jobManager: BOQImportJobManager,
    dataProcessor: BOQImportDataProcessor,
    databaseSaver: BOQImportDatabaseSaver
  ) {
    this.jobManager = jobManager;
    this.dataProcessor = dataProcessor;
    this.databaseSaver = databaseSaver;
  }

  /**
   * Process import job through all stages
   */
  async processImport(
    job: ImportJob,
    file: File,
    context: ProcurementContext,
    config: ImportConfig,
    onProgress?: ProgressCallback
  ): Promise<void> {
    try {
      // Stage 1: Parse file
      await this.parseStage(job, file, config, onProgress);
      
      // Stage 2: Validate and clean data
      await this.validateStage(job, onProgress);
      
      // Stage 3: Map to catalog
      await this.mappingStage(job, config, onProgress);
      
      // Stage 4: Save to database
      await this.saveStage(job, context, config, onProgress);
      
      // Complete job
      this.completeJob(job, onProgress);
      
    } catch (error) {
      this.handleJobError(job, error, onProgress);
      throw error;
    }
  }

  /**
   * Stage 1: Parse Excel file
   */
  private async parseStage(
    job: ImportJob,
    file: File,
    config: ImportConfig,
    onProgress?: ProgressCallback
  ): Promise<void> {
    this.jobManager.updateProgress(job.id, 'parsing', 5);
    this.updateProgress(job, 'parsing', 5, 'Parsing Excel file...', onProgress);

    const parseStart = Date.now();
    const parseConfig = {
      strictValidation: config.strictValidation
    };
    
    const parseResult = await parseFile(file, parseConfig);
    job.metadata.parseTime = Date.now() - parseStart;
    job.metadata.totalRows = parseResult.items.length;

    // Store parsed data in job for next stage
    (job as ProcessingJob).parsedItems = parseResult.items;

    this.updateProgress(job, 'parsing', 20, `Parsed ${parseResult.items.length} items`, onProgress);
  }

  /**
   * Stage 2: Validate and clean data
   */
  private async validateStage(
    job: ImportJob,
    onProgress?: ProgressCallback
  ): Promise<void> {
    this.jobManager.updateProgress(job.id, 'validating', 30);
    this.updateProgress(job, 'validating', 30, 'Validating data...', onProgress);

    const parsedItems = (job as ProcessingJob).parsedItems;
    const validItems = this.dataProcessor.validateParsedItems(parsedItems);
    
    job.metadata.validRows = validItems.length;
    job.metadata.skippedRows = parsedItems.length - validItems.length;

    // Store validated data for next stage
    (job as ProcessingJob).validItems = validItems;

    this.updateProgress(job, 'validating', 50, `Validated ${validItems.length} items`, onProgress);
  }

  /**
   * Stage 3: Map items to catalog
   */
  private async mappingStage(
    job: ImportJob,
    config: ImportConfig,
    onProgress?: ProgressCallback
  ): Promise<void> {
    this.jobManager.updateProgress(job.id, 'mapping', 60);
    this.updateProgress(job, 'mapping', 60, 'Mapping to catalog...', onProgress);

    const validItems = (job as ProcessingJob).validItems;
    const mappingStart = Date.now();
    
    const mappingResults = await this.dataProcessor.mapToCatalog(validItems, config);
    
    job.metadata.mappingTime = Date.now() - mappingStart;
    job.metadata.autoMappedItems = mappingResults.mapped.length;
    job.metadata.exceptionsCount = mappingResults.exceptions.length;

    // Store mapping results for next stage
    (job as ProcessingJob).mappingResults = mappingResults;

    this.updateProgress(job, 'mapping', 80, `Mapped ${mappingResults.mapped.length} items`, onProgress);
  }

  /**
   * Stage 4: Save to database
   */
  private async saveStage(
    job: ImportJob,
    context: ProcurementContext,
    config: ImportConfig,
    onProgress?: ProgressCallback
  ): Promise<void> {
    this.jobManager.updateProgress(job.id, 'saving', 90);
    this.updateProgress(job, 'saving', 90, 'Saving to database...', onProgress);

    const mappingResults = (job as ProcessingJob).mappingResults;
    const saveStart = Date.now();
    
    const saveResult = await this.databaseSaver.saveBOQData(mappingResults, context, config);
    
    job.metadata.saveTime = Date.now() - saveStart;
    job.result = saveResult;
  }

  /**
   * Complete job successfully
   */
  private completeJob(job: ImportJob, onProgress?: ProgressCallback): void {
    this.jobManager.updateProgress(job.id, 'completed', 100);
    this.updateProgress(job, 'completed', 100, 'Import completed successfully', onProgress);
    this.jobManager.moveToHistory(job.id);
  }

  /**
   * Handle job error
   */
  private handleJobError(job: ImportJob, error: unknown, onProgress?: ProgressCallback): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    this.jobManager.updateProgress(job.id, 'failed', job.progress, errorMessage);
    this.updateProgress(job, 'failed', 100, errorMessage, onProgress);
  }

  /**
   * Update job progress and notify callback
   */
  private updateProgress(
    job: ImportJob, 
    stage: string, 
    progress: number, 
    message?: string,
    onProgress?: ProgressCallback
  ): void {
    job.progress = progress;
    onProgress?.(job, stage, progress, message);
  }

  /**
   * Validate file before processing
   */
  validateFile(file: File): { valid: boolean; error?: string } {
    return validateFile(file);
  }
}