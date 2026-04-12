/**
 * Import Engine - Progress Management
 * Handles progress tracking and callback notifications
 */

import { ImportProgress, ImportError, ImportWarning, ProgressCallback } from './types';
import { log } from '@/lib/logger';

export class ProgressManager {
  private callback: ProgressCallback;

  constructor(callback: ProgressCallback = () => {}) {
    this.callback = callback;
  }

  /**
   * Update progress and notify callback
   */
  updateProgress(progress: ImportProgress): void {
    try {
      this.callback(progress);
    } catch (error) {
      // Ignore callback errors to prevent import interruption
      log.warn('Progress callback error:', { data: error }, 'progressManager');
    }
  }

  /**
   * Create progress update for file reading phase
   */
  createParsingProgress(
    progress: number, 
    processedRows: number, 
    totalRows: number, 
    message: string
  ): ImportProgress {
    return {
      phase: 'parsing',
      progress,
      processedRows,
      totalRows,
      message,
      errors: [],
      warnings: []
    };
  }

  /**
   * Create progress update for validation phase
   */
  createValidationProgress(
    progress: number,
    processedRows: number,
    totalRows: number,
    message: string,
    errors: ImportError[] = [],
    warnings: ImportWarning[] = []
  ): ImportProgress {
    return {
      phase: 'validating',
      progress,
      processedRows,
      totalRows,
      message,
      errors,
      warnings
    };
  }

  /**
   * Create progress update for processing phase
   */
  createProcessingProgress(
    progress: number,
    processedRows: number,
    totalRows: number,
    message: string,
    errors: ImportError[] = [],
    warnings: ImportWarning[] = []
  ): ImportProgress {
    return {
      phase: 'processing',
      progress,
      processedRows,
      totalRows,
      message,
      errors,
      warnings
    };
  }

  /**
   * Create progress update for completion phase
   */
  createCompleteProgress(
    totalRows: number,
    message: string,
    errors: ImportError[] = [],
    warnings: ImportWarning[] = []
  ): ImportProgress {
    return {
      phase: 'complete',
      progress: 100,
      processedRows: totalRows,
      totalRows,
      message,
      errors,
      warnings
    };
  }

  /**
   * Create progress update for error phase
   */
  createErrorProgress(
    message: string,
    errors: ImportError[] = [],
    warnings: ImportWarning[] = []
  ): ImportProgress {
    return {
      phase: 'error',
      progress: 0,
      processedRows: 0,
      totalRows: 0,
      message,
      errors,
      warnings
    };
  }

  /**
   * Set new progress callback
   */
  setCallback(callback: ProgressCallback): void {
    this.callback = callback;
  }
}