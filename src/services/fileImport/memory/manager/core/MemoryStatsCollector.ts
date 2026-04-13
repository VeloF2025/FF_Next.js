/**
 * Memory Stats Collector
 * Collects and records memory statistics
 */

import type { MemoryStats } from '../../../types';

export class MemoryStatsCollector {
  private memoryHistory: MemoryStats[] = [];
  private readonly maxHistoryLength = 100;

  /**
   * Get current memory statistics
   */
  public getCurrentMemoryStats(): MemoryStats {
    if (typeof window !== 'undefined' && 'performance' in window && 'memory' in performance) {
      const memory = (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
      return {
        heapUsed: memory.usedJSHeapSize,
        heapTotal: memory.totalJSHeapSize,
        external: 0, // Not available in browser
        peakUsage: Math.max(
          memory.usedJSHeapSize,
          this.getPeakUsage()
        )
      };
    }

    // Fallback for environments without memory API
    return {
      heapUsed: 0,
      heapTotal: 0,
      external: 0,
      peakUsage: 0
    };
  }

  /**
   * Record memory statistics in history
   */
  public recordMemoryStats(stats: MemoryStats): void {
    this.memoryHistory.push({
      ...stats,
      gcCount: this.memoryHistory.length // Simple counter for history
    });

    // Keep history within limits
    if (this.memoryHistory.length > this.maxHistoryLength) {
      this.memoryHistory.shift();
    }
  }

  /**
   * Get peak memory usage from history
   */
  public getPeakUsage(): number {
    if (this.memoryHistory.length === 0) return 0;

    return Math.max(...this.memoryHistory.map(stats => stats.heapUsed));
  }

  /**
   * Get memory history
   */
  public getHistory(): MemoryStats[] {
    return [...this.memoryHistory];
  }

  /**
   * Clear memory history
   */
  public clearHistory(): void {
    this.memoryHistory = [];
  }

  /**
   * Trim history to keep only recent entries
   */
  public trimHistory(keepCount: number = 10): void {
    this.memoryHistory = this.memoryHistory.slice(-keepCount);
  }
}
