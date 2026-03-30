/**
 * Sync Statistics Manager
 * Collects and analyzes synchronization performance metrics
 */

import { SyncStatistics, FullSyncResult } from './types';

export class SyncStatisticsManager {
  private syncHistory: FullSyncResult[] = [];
  private startTime: number = Date.now();
  private syncTypeStats: Map<string, any> = new Map();

  constructor() {
    this.initializeSyncTypeStats();
  }

  /**
   * Add sync result to history
   */
  addSyncResult(result: FullSyncResult): void {
    this.syncHistory.push(result);
    
    // Update per-type statistics
    Object.entries(result.byType).forEach(([type, typeResult]) => {
      this.updateSyncTypeStats(type, typeResult, result.duration);
    });

    // Keep only last 100 sync results
    if (this.syncHistory.length > 100) {
      this.syncHistory = this.syncHistory.slice(-100);
    }
  }

  /**
   * Generate comprehensive sync statistics
   */
  async getSyncStatistics(): Promise<SyncStatistics> {
    const totalSyncs = this.syncHistory.length;
    const successfulSyncs = this.syncHistory.filter(r => r.success).length;
    const failedSyncs = totalSyncs - successfulSyncs;

    const durations = this.syncHistory.map(r => r.duration);
    const averageSyncDuration = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;

    const lastSyncTime = this.syncHistory.length > 0 
      ? new Date(Math.max(...this.syncHistory.map(r => new Date(r.duration).getTime()))) 
      : null;

    const uptime = Date.now() - this.startTime;
    const errorRate = totalSyncs > 0 ? (failedSyncs / totalSyncs) * 100 : 0;

    // Get recent errors (last 20)
    const recentErrors = this.syncHistory
      .flatMap(r => r.errors)
      .slice(-20);

    // Calculate performance metrics
    const totalRecords = this.syncHistory.reduce((sum, r) => sum + r.totalRecords, 0);
    const totalDuration = this.syncHistory.reduce((sum, r) => sum + r.duration, 0);
    const recordsPerSecond = totalDuration > 0 ? (totalRecords / (totalDuration / 1000)) : 0;
    const peakSyncTime = Math.max(...durations.filter(d => d > 0), 0);
    const averageRecordsPerSync = totalSyncs > 0 ? totalRecords / totalSyncs : 0;

    return {
      totalSyncs,
      successfulSyncs,
      failedSyncs,
      averageSyncDuration,
      lastSyncTime,
      uptime,
      errorRate,
      syncTypes: this.getSyncTypeStatistics(),
      recentErrors,
      performance: {
        recordsPerSecond,
        peakSyncTime,
        averageRecordsPerSync
      }
    };
  }

  /**
   * Get statistics for each sync type
   */
  private getSyncTypeStatistics(): { [key: string]: any } {
    const stats: { [key: string]: any } = {};

    this.syncTypeStats.forEach((typeStats, type) => {
      stats[type] = {
        totalSyncs: typeStats.totalSyncs,
        successCount: typeStats.successCount,
        failureCount: typeStats.failureCount,
        lastSyncTime: typeStats.lastSyncTime,
        averageDuration: typeStats.totalDuration > 0 
          ? typeStats.totalDuration / typeStats.totalSyncs 
          : 0
      };
    });

    return stats;
  }

  /**
   * Initialize sync type statistics
   */
  private initializeSyncTypeStats(): void {
    const syncTypes = ['projects', 'clients', 'staff'];
    
    syncTypes.forEach(type => {
      this.syncTypeStats.set(type, {
        totalSyncs: 0,
        successCount: 0,
        failureCount: 0,
        lastSyncTime: null,
        totalDuration: 0
      });
    });
  }

  /**
   * Update statistics for a specific sync type
   */
  private updateSyncTypeStats(type: string, typeResult: any, duration: number): void {
    const stats = this.syncTypeStats.get(type) || {
      totalSyncs: 0,
      successCount: 0,
      failureCount: 0,
      lastSyncTime: null,
      totalDuration: 0
    };

    stats.totalSyncs++;
    stats.lastSyncTime = new Date();
    stats.totalDuration += duration;

    if (typeResult.failed === 0) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    this.syncTypeStats.set(type, stats);
  }

  /**
   * Reset statistics
   */
  resetStatistics(): void {
    this.syncHistory = [];
    this.startTime = Date.now();
    this.initializeSyncTypeStats();
  }

  /**
   * Export statistics for analysis
   */
  exportStatistics(): any {
    return {
      syncHistory: this.syncHistory,
      syncTypeStats: Object.fromEntries(this.syncTypeStats),
      startTime: this.startTime,
      exportTime: Date.now()
    };
  }
}