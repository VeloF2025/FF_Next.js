/**
 * BOQ Import Statistics Calculator
 * Calculate comprehensive import statistics and metrics
 */

import { ImportJob, ImportStats, ImportJobStatus } from './types';
import { BOQImportJobManager } from './jobManager';

export class BOQImportStatsCalculator {
  private jobManager: BOQImportJobManager;

  constructor(jobManager: BOQImportJobManager) {
    this.jobManager = jobManager;
  }

  /**
   * Get comprehensive import statistics
   */
  getImportStats(): ImportStats {
    const allJobs = [...this.jobManager.getActiveJobs(), ...this.jobManager.getJobHistory()];
    const completed = allJobs.filter(job => job.status === 'completed');
    const failed = allJobs.filter(job => job.status === 'failed');

    return {
      totalJobs: allJobs.length,
      completedJobs: completed.length,
      failedJobs: failed.length,
      averageProcessingTime: this.calculateAverageProcessingTime(completed),
      totalItemsImported: this.calculateTotalItemsImported(completed),
      averageMappingConfidence: this.calculateAverageMappingConfidence(completed),
      topFailureReasons: this.getTopFailureReasons(failed)
    };
  }

  /**
   * Calculate average processing time for completed jobs
   */
  private calculateAverageProcessingTime(completed: ImportJob[]): number {
    if (completed.length === 0) return 0;

    const totalTime = completed.reduce((sum, job) => {
      if (job.startedAt && job.completedAt) {
        return sum + (job.completedAt.getTime() - job.startedAt.getTime());
      }
      return sum;
    }, 0);

    return totalTime / completed.length;
  }

  /**
   * Calculate total items imported across all completed jobs
   */
  private calculateTotalItemsImported(completed: ImportJob[]): number {
    return completed.reduce((sum, job) => sum + (job.result?.itemsCreated || 0), 0);
  }

  /**
   * Calculate average mapping confidence
   */
  private calculateAverageMappingConfidence(_completed: ImportJob[]): number {
    // TODO: This would need to be calculated from actual mapping results
    // For now, return a placeholder value
    return 0.85; // 85% average confidence
  }

  /**
   * Get top failure reasons
   */
  private getTopFailureReasons(failed: ImportJob[]): Array<{ reason: string; count: number }> {
    const reasonCounts = failed.reduce((reasons: any[], job) => {
      if (job.error) {
        const existing = reasons.find(r => r.reason === job.error);
        if (existing) {
          existing.count++;
        } else {
          reasons.push({ reason: job.error, count: 1 });
        }
      }
      return reasons;
    }, []);

    return reasonCounts
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Get job statistics by status
   */
  getJobStatsByStatus(): Record<ImportJobStatus, number> {
    const allJobs = [...this.jobManager.getActiveJobs(), ...this.jobManager.getJobHistory()];
    const statuses: ImportJobStatus[] = [
      'queued', 'parsing', 'validating', 'mapping', 'saving', 
      'completed', 'failed', 'cancelled'
    ];

    const stats: Record<ImportJobStatus, number> = {} as any;
    
    statuses.forEach(status => {
      stats[status] = allJobs.filter(job => job.status === status).length;
    });

    return stats;
  }

  /**
   * Get processing time breakdown
   */
  getProcessingTimeBreakdown(): {
    averageParseTime: number;
    averageMappingTime: number;
    averageSaveTime: number;
    totalAverageTime: number;
  } {
    const completed = this.jobManager.getJobHistory().filter(job => job.status === 'completed');
    
    if (completed.length === 0) {
      return {
        averageParseTime: 0,
        averageMappingTime: 0,
        averageSaveTime: 0,
        totalAverageTime: 0
      };
    }

    const parseTime = completed.reduce((sum, job) => sum + job.metadata.parseTime, 0) / completed.length;
    const mappingTime = completed.reduce((sum, job) => sum + job.metadata.mappingTime, 0) / completed.length;
    const saveTime = completed.reduce((sum, job) => sum + job.metadata.saveTime, 0) / completed.length;

    return {
      averageParseTime: parseTime,
      averageMappingTime: mappingTime,
      averageSaveTime: saveTime,
      totalAverageTime: parseTime + mappingTime + saveTime
    };
  }

  /**
   * Get data quality metrics
   */
  getDataQualityMetrics(): {
    averageValidationRate: number;
    averageMappingRate: number;
    totalRowsProcessed: number;
    totalValidRows: number;
    totalSkippedRows: number;
  } {
    const completed = this.jobManager.getJobHistory().filter(job => job.status === 'completed');
    
    if (completed.length === 0) {
      return {
        averageValidationRate: 0,
        averageMappingRate: 0,
        totalRowsProcessed: 0,
        totalValidRows: 0,
        totalSkippedRows: 0
      };
    }

    const totalRows = completed.reduce((sum, job) => sum + job.metadata.totalRows, 0);
    const validRows = completed.reduce((sum, job) => sum + job.metadata.validRows, 0);
    const skippedRows = completed.reduce((sum, job) => sum + job.metadata.skippedRows, 0);
    const mappedItems = completed.reduce((sum, job) => sum + job.metadata.autoMappedItems, 0);

    const validationRate = totalRows > 0 ? (validRows / totalRows) * 100 : 0;
    const mappingRate = validRows > 0 ? (mappedItems / validRows) * 100 : 0;

    return {
      averageValidationRate: validationRate,
      averageMappingRate: mappingRate,
      totalRowsProcessed: totalRows,
      totalValidRows: validRows,
      totalSkippedRows: skippedRows
    };
  }

  /**
   * Get recent import trends
   */
  getRecentTrends(days: number = 30): {
    dailyImports: Array<{ date: string; count: number }>;
    successRate: number;
    trendDirection: 'up' | 'down' | 'stable';
  } {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const recentJobs = this.jobManager.getJobHistory().filter(job => 
      job.createdAt >= cutoffDate
    );

    // Group by date
    const dailyCounts = new Map<string, number>();
    recentJobs.forEach(job => {
      const dateKey = job.createdAt.toISOString().split('T')[0]!;
      dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1);
    });

    const dailyImports = Array.from(dailyCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const successfulJobs = recentJobs.filter(job => job.status === 'completed').length;
    const successRate = recentJobs.length > 0 ? (successfulJobs / recentJobs.length) * 100 : 0;

    // Simple trend calculation (compare first half vs second half)
    const midpoint = Math.floor(dailyImports.length / 2);
    const firstHalfAvg = dailyImports.slice(0, midpoint).reduce((sum, day) => sum + day.count, 0) / midpoint || 0;
    const secondHalfAvg = dailyImports.slice(midpoint).reduce((sum, day) => sum + day.count, 0) / (dailyImports.length - midpoint) || 0;

    let trendDirection: 'up' | 'down' | 'stable' = 'stable';
    if (secondHalfAvg > firstHalfAvg * 1.1) {
      trendDirection = 'up';
    } else if (secondHalfAvg < firstHalfAvg * 0.9) {
      trendDirection = 'down';
    }

    return {
      dailyImports,
      successRate,
      trendDirection
    };
  }
}