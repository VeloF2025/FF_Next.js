/**
 * Progress Tracker
 * Handles import progress tracking and callback management
 */

import type { ImportProgress, ImportError, ImportWarning, ProgressCallback } from './importTypes';
import { log } from '@/lib/logger';

export class ProgressTracker {
  private callback: ProgressCallback = () => {};

  constructor(callback?: ProgressCallback) {
    if (callback) {
      this.callback = callback;
    }
  }

  /**
   * Update progress and notify callback
   */
  updateProgress(progress: ImportProgress): void {
    try {
      this.callback(progress);
    } catch (error) {
      // Ignore callback errors to prevent import interruption
      log.warn('Progress callback error:', { data: error }, 'progressTracker');
    }
  }

  /**
   * Update callback function
   */
  setCallback(callback: ProgressCallback): void {
    this.callback = callback;
  }

  /**
   * Create progress update for parsing phase
   */
  createParsingProgress(
    progress: number,
    processedRows: number,
    totalRows: number,
    message: string,
    errors: ImportError[] = [],
    warnings: ImportWarning[] = []
  ): ImportProgress {
    return {
      phase: 'parsing',
      progress,
      processedRows,
      totalRows,
      message,
      errors,
      warnings
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
   * Create progress update for completion
   */
  createCompleteProgress(
    processedRows: number,
    totalRows: number,
    message: string,
    errors: ImportError[] = [],
    warnings: ImportWarning[] = []
  ): ImportProgress {
    return {
      phase: 'complete',
      progress: 100,
      processedRows,
      totalRows,
      message,
      errors,
      warnings
    };
  }

  /**
   * Create progress update for error
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
}