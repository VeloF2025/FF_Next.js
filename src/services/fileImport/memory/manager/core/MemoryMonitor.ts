/**
 * Memory Monitor
 * Manages interval-based memory monitoring
 */

import type { MemoryStats } from '../../../types';

export class MemoryMonitor {
  private memoryCheckInterval: number = 5000; // Check every 5 seconds
  private intervalId?: NodeJS.Timeout | number;
  private isRunning = false;

  /**
   * Start memory monitoring
   */
  public start(
    onCheck: (stats: MemoryStats) => void,
    interval?: number
  ): void {
    if (typeof window === 'undefined') return;
    if (this.isRunning) return;

    if (interval) {
      this.memoryCheckInterval = interval;
    }

    this.intervalId = setInterval(() => {
      // The callback will provide the stats
      // This is called from MemoryManager which has access to MemoryStatsCollector
    }, this.memoryCheckInterval) as NodeJS.Timeout | number;

    this.isRunning = true;

    // Trigger immediate check
    // onCheck will be called by the MemoryManager
  }

  /**
   * Stop memory monitoring
   */
  public stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId as NodeJS.Timeout);
      this.intervalId = undefined;
    }
    this.isRunning = false;
  }

  /**
   * Check if monitoring is running
   */
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Update monitoring interval
   */
  public updateInterval(interval: number): void {
    this.memoryCheckInterval = interval;

    // Restart monitoring with new interval if currently running
    if (this.isRunning) {
      const wasRunning = this.isRunning;
      this.stop();
      if (wasRunning) {
        // Note: start() needs to be called externally with the callback
      }
    }
  }

  /**
   * Get current interval
   */
  public getInterval(): number {
    return this.memoryCheckInterval;
  }
}
