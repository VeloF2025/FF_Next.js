/**
 * File Processing Analyzer
 * Estimates memory requirements and processing feasibility
 */

import type { MemoryStats } from '../../../types';
import type { ProcessingFeasibility } from '../types/memory-manager.types';
import { estimateFileMemory, formatBytes } from '../utils/memoryUtils';

export class FileProcessingAnalyzer {
  /**
   * Estimate memory needed for processing a file
   */
  public estimateMemoryNeeded(fileSize: number, fileType: string): number {
    return estimateFileMemory(fileSize, fileType);
  }

  /**
   * Check if processing is feasible with current memory
   */
  public canProcessFile(
    fileSize: number,
    fileType: string,
    currentStats: MemoryStats
  ): ProcessingFeasibility {
    const needed = this.estimateMemoryNeeded(fileSize, fileType);
    const available = currentStats.heapTotal - currentStats.heapUsed;
    const suggestions: string[] = [];

    if (currentStats.heapTotal === 0) {
      // Memory API not available
      return {
        canProcess: true,
        suggestions: ['Memory monitoring not available - proceed with caution']
      };
    }

    if (needed > available * 0.8) {
      suggestions.push('Use streaming mode to reduce memory usage');
      suggestions.push('Process file in smaller chunks');
      suggestions.push('Consider using Web Workers');

      if (needed > available * 1.2) {
        return {
          canProcess: false,
          reason: `Estimated memory needed (${formatBytes(needed)}) exceeds available memory (${formatBytes(available)})`,
          suggestions
        };
      }

      return {
        canProcess: true,
        reason: 'Memory usage will be high',
        suggestions
      };
    }

    return {
      canProcess: true,
      suggestions: ['Memory usage should be within acceptable limits']
    };
  }

  /**
   * Get memory requirements summary for a file
   */
  public getMemoryRequirements(
    fileSize: number,
    fileType: string,
    currentStats: MemoryStats
  ): {
    fileSize: string;
    estimatedMemory: string;
    availableMemory: string;
    feasibility: ProcessingFeasibility;
  } {
    const needed = this.estimateMemoryNeeded(fileSize, fileType);
    const available = currentStats.heapTotal - currentStats.heapUsed;

    return {
      fileSize: formatBytes(fileSize),
      estimatedMemory: formatBytes(needed),
      availableMemory: formatBytes(available),
      feasibility: this.canProcessFile(fileSize, fileType, currentStats)
    };
  }
}
