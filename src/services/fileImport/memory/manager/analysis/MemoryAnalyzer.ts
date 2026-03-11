/**
 * Memory Analyzer
 * Analyzes memory trends and provides recommendations
 */

import type { MemoryStats } from '../../../types';
import type { MemoryTrend, MemoryThresholds } from '../types/memory-manager.types';
import { calculateUsageRatio } from '../utils/memoryUtils';

export class MemoryAnalyzer {
  private warningThreshold: number;
  private criticalThreshold: number;

  constructor(thresholds: MemoryThresholds) {
    this.warningThreshold = thresholds.warning;
    this.criticalThreshold = thresholds.critical;
  }

  /**
   * Get memory usage trend from history
   */
  public getMemoryTrend(history: MemoryStats[]): MemoryTrend {
    if (history.length < 5) return 'stable';

    const recent = history.slice(-5);
    const first = recent[0]!.heapUsed;
    const last = recent[recent.length - 1]!.heapUsed;

    const change = (last - first) / first;

    if (Math.abs(change) < 0.05) return 'stable';
    return change > 0 ? 'increasing' : 'decreasing';
  }

  /**
   * Get memory recommendations based on current stats and trend
   */
  public getMemoryRecommendations(
    currentStats: MemoryStats,
    history: MemoryStats[],
    peakUsage: number
  ): string[] {
    const recommendations: string[] = [];

    if (currentStats.heapTotal === 0) {
      return ['Memory monitoring not available in this environment'];
    }

    const usageRatio = calculateUsageRatio(currentStats.heapUsed, currentStats.heapTotal);
    const trend = this.getMemoryTrend(history);

    if (usageRatio > this.warningThreshold) {
      recommendations.push('Consider processing data in smaller chunks');
      recommendations.push('Enable streaming mode for large files');
    }

    if (trend === 'increasing') {
      recommendations.push('Memory usage is trending upward - monitor closely');
      recommendations.push('Consider clearing unnecessary data structures');
    }

    if (history.length > 50 && peakUsage > currentStats.heapTotal * 0.95) {
      recommendations.push('Peak memory usage is very high - consider using Web Workers');
    }

    return recommendations.length > 0
      ? recommendations
      : ['Memory usage is within normal limits'];
  }

  /**
   * Update analysis thresholds
   */
  public updateThresholds(thresholds: Partial<MemoryThresholds>): void {
    if (thresholds.warning !== undefined) {
      this.warningThreshold = thresholds.warning;
    }
    if (thresholds.critical !== undefined) {
      this.criticalThreshold = thresholds.critical;
    }
  }
}
