/**
 * Progress Tracker
 * Tracks and estimates progress for file processing operations
 */

import type { FileProcessingProgress, ProcessingPhase } from '../types';

export class ProgressTracker {
  private progressHistory: Map<string, FileProcessingProgress[]> = new Map();
  private phaseWeights: Record<ProcessingPhase, number> = {
    initializing: 0.05,
    reading: 0.15,
    parsing: 0.50,
    validating: 0.20,
    transforming: 0.08,
    finalizing: 0.02,
    complete: 0.00,
    error: 0.00
  };

  /**
   * Create initial progress state
   */
  public createProgress(
    fileId: string,
    totalBytes: number,
    estimatedRows: number = 0
  ): FileProcessingProgress {
    const progress: FileProcessingProgress = {
      processedRows: 0,
      totalRows: estimatedRows || this.estimateRowsFromBytes(totalBytes),
      percentage: 0,
      estimatedTimeRemaining: 0,
      currentPhase: 'initializing',
      bytesProcessed: 0,
      totalBytes,
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        peakUsage: 0
      }
    };

    // Initialize history
    this.progressHistory.set(fileId, [progress]);
    
    return progress;
  }

  /**
   * Update progress for a file
   */
  public updateProgress(
    fileId: string,
    updates: Partial<FileProcessingProgress>
  ): FileProcessingProgress {
    const history = this.progressHistory.get(fileId) || [];
    const lastProgress = history[history.length - 1];
    
    if (!lastProgress) {
      throw new Error(`No progress tracking found for file: ${fileId}`);
    }

    const newProgress: FileProcessingProgress = {
      ...lastProgress,
      ...updates,
      percentage: this.calculatePercentage(lastProgress, updates),
      estimatedTimeRemaining: this.calculateTimeRemaining(fileId, lastProgress, updates)
    };

    // Add to history
    history.push(newProgress);
    
    // Keep history manageable (last 100 updates)
    if (history.length > 100) {
      history.shift();
    }

    this.progressHistory.set(fileId, history);
    
    return newProgress;
  }

  /**
   * Calculate overall percentage based on phase and progress
   */
  private calculatePercentage(
    lastProgress: FileProcessingProgress,
    updates: Partial<FileProcessingProgress>
  ): number {
    const currentPhase = updates.currentPhase || lastProgress.currentPhase;
    const bytesProcessed = updates.bytesProcessed || lastProgress.bytesProcessed;
    const totalBytes = updates.totalBytes || lastProgress.totalBytes;
    const processedRows = updates.processedRows || lastProgress.processedRows;
    const totalRows = updates.totalRows || lastProgress.totalRows;

    // Calculate phase completion percentage
    let phaseCompletion = 0;
    
    if (currentPhase === 'reading' || currentPhase === 'parsing') {
      // Use bytes or rows, whichever gives better estimate
      const bytesPercentage = totalBytes > 0 ? (bytesProcessed / totalBytes) * 100 : 0;
      const rowsPercentage = totalRows > 0 ? (processedRows / totalRows) * 100 : 0;
      phaseCompletion = Math.max(bytesPercentage, rowsPercentage);
    } else if (currentPhase === 'validating' || currentPhase === 'transforming') {
      // Use rows for validation and transformation
      phaseCompletion = totalRows > 0 ? (processedRows / totalRows) * 100 : 0;
    } else if (currentPhase === 'complete') {
      phaseCompletion = 100;
    } else {
      // For other phases, use a simple progression
      phaseCompletion = 50; // Assume halfway through the phase
    }

    // Calculate cumulative percentage based on phase weights
    const completedPhases = this.getCompletedPhases(currentPhase);
    const completedWeight = completedPhases.reduce((sum, phase) => sum + this.phaseWeights[phase], 0);
    const currentPhaseWeight = this.phaseWeights[currentPhase];
    const currentPhaseProgress = (phaseCompletion / 100) * currentPhaseWeight;
    
    return Math.min(100, (completedWeight + currentPhaseProgress) * 100);
  }

  /**
   * Get phases that are completed before current phase
   */
  private getCompletedPhases(currentPhase: ProcessingPhase): ProcessingPhase[] {
    const phases: ProcessingPhase[] = [
      'initializing',
      'reading',
      'parsing',
      'validating',
      'transforming',
      'finalizing'
    ];

    const currentIndex = phases.indexOf(currentPhase);
    return currentIndex > 0 ? phases.slice(0, currentIndex) : [];
  }

  /**
   * Calculate estimated time remaining
   */
  private calculateTimeRemaining(
    fileId: string,
    lastProgress: FileProcessingProgress,
    updates: Partial<FileProcessingProgress>
  ): number {
    const history = this.progressHistory.get(fileId) || [];
    
    if (history.length < 2) {
      return 0; // Not enough data for estimation
    }

    const currentTime = Date.now();
    // Use last 10 data points for analysis
    void history.slice(-10);
    
    // Calculate processing rate
    const startTime = this.getStartTime(fileId);
    const elapsedTime = currentTime - startTime;
    
    if (elapsedTime === 0) return 0;

    const currentPercentage = this.calculatePercentage(lastProgress, updates);
    
    if (currentPercentage === 0) return 0;

    // Calculate remaining percentage for future use
    const remainingPercentage = 100 - currentPercentage;
    // Note: remainingPercentage could be used for more detailed ETA calculations
    // Currently using elapsed time ratio method instead
    const estimatedTotal = (elapsedTime / currentPercentage) * 100;
    const estimatedRemaining = estimatedTotal - elapsedTime;

    // Apply phase-based adjustments
    const currentPhase = updates.currentPhase || lastProgress.currentPhase;
    const adjustmentFactor = this.getPhaseAdjustmentFactor(currentPhase);
    
    return Math.max(0, estimatedRemaining * adjustmentFactor);
  }

  /**
   * Get phase adjustment factor for time estimation
   */
  private getPhaseAdjustmentFactor(phase: ProcessingPhase): number {
    // Different phases have different processing speeds
    const factors: Record<ProcessingPhase, number> = {
      initializing: 0.5, // Usually fast
      reading: 1.0,      // Baseline
      parsing: 1.2,      // Can be slower for complex files
      validating: 0.8,   // Usually faster than parsing
      transforming: 1.0, // Baseline
      finalizing: 0.3,   // Usually fast
      complete: 0,
      error: 0
    };

    return factors[phase] || 1.0;
  }

  /**
   * Get start time for processing
   */
  private getStartTime(fileId: string): number {
    const history = this.progressHistory.get(fileId);
    return history && history.length > 0 ? Date.now() - (history.length * 100) : Date.now();
  }

  /**
   * Estimate rows from file size
   */
  private estimateRowsFromBytes(totalBytes: number): number {
    // Rough estimate: average 50 bytes per row for CSV, 100 for Excel
    return Math.ceil(totalBytes / 75);
  }

  /**
   * Get progress statistics
   */
  public getProgressStats(fileId: string): {
    current: FileProcessingProgress | null;
    averageSpeed: number; // rows per second
    peakSpeed: number;
    efficiency: number; // percentage
    phases: Record<ProcessingPhase, number>; // time spent in each phase
  } {
    const history = this.progressHistory.get(fileId);
    
    if (!history || history.length === 0) {
      return {
        current: null,
        averageSpeed: 0,
        peakSpeed: 0,
        efficiency: 0,
        phases: {} as Record<ProcessingPhase, number>
      };
    }

    const current = history[history.length - 1];
    const speeds = this.calculateSpeeds(history);
    const phases = this.calculatePhaseTime(history);
    
    return {
      current: current!,
      averageSpeed: speeds.average,
      peakSpeed: speeds.peak,
      efficiency: this.calculateEfficiency(history),
      phases
    };
  }

  /**
   * Calculate processing speeds
   */
  private calculateSpeeds(history: FileProcessingProgress[]): {
    average: number;
    peak: number;
  } {
    if (history.length < 2) {
      return { average: 0, peak: 0 };
    }

    const speeds: number[] = [];
    
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]!;
      const curr = history[i]!;
      const timeDiff = 100; // Assuming 100ms between updates
      const rowsDiff = curr.processedRows - prev.processedRows;
      
      if (timeDiff > 0 && rowsDiff > 0) {
        speeds.push(rowsDiff / (timeDiff / 1000)); // rows per second
      }
    }

    if (speeds.length === 0) {
      return { average: 0, peak: 0 };
    }

    return {
      average: speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length,
      peak: Math.max(...speeds)
    };
  }

  /**
   * Calculate efficiency based on processing consistency
   */
  private calculateEfficiency(history: FileProcessingProgress[]): number {
    if (history.length < 5) return 100; // Not enough data

    const speeds = this.calculateSpeeds(history);
    if (speeds.average === 0) return 100;

    // Efficiency is based on how consistent the speed is
    const speedVariations: number[] = [];
    
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1]!;
      const curr = history[i]!;
      const rowsDiff = curr.processedRows - prev.processedRows;
      const speed = rowsDiff / 0.1; // Assuming 100ms intervals
      
      if (speed > 0) {
        speedVariations.push(Math.abs(speed - speeds.average) / speeds.average);
      }
    }

    if (speedVariations.length === 0) return 100;

    const avgVariation = speedVariations.reduce((sum, v) => sum + v, 0) / speedVariations.length;
    return Math.max(0, Math.min(100, (1 - avgVariation) * 100));
  }

  /**
   * Calculate time spent in each phase
   */
  private calculatePhaseTime(history: FileProcessingProgress[]): Record<ProcessingPhase, number> {
    const phases: Record<ProcessingPhase, number> = {
      initializing: 0,
      reading: 0,
      parsing: 0,
      validating: 0,
      transforming: 0,
      finalizing: 0,
      complete: 0,
      error: 0
    };

    let currentPhase: ProcessingPhase = 'initializing';
    let phaseStartIndex = 0;

    for (let i = 0; i < history.length; i++) {
      const progress = history[i]!;

      if (progress.currentPhase !== currentPhase) {
        // Phase changed, record time for previous phase
        const timeInPhase = (i - phaseStartIndex) * 100; // Assuming 100ms intervals
        phases[currentPhase] += timeInPhase;
        
        currentPhase = progress!.currentPhase;
        phaseStartIndex = i;
      }
    }

    // Add time for final phase
    const finalTime = (history.length - 1 - phaseStartIndex) * 100;
    phases[currentPhase] += finalTime;

    return phases;
  }

  /**
   * Clean up progress tracking for completed files
   */
  public cleanup(fileId: string): void {
    this.progressHistory.delete(fileId);
  }

  /**
   * Get all active progress tracking
   */
  public getActiveTracking(): string[] {
    return Array.from(this.progressHistory.keys());
  }

  /**
   * Clear all progress tracking
   */
  public clearAll(): void {
    this.progressHistory.clear();
  }
}