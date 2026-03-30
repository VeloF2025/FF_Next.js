/**
 * Periodic Sync Manager
 * Handles scheduled synchronization intervals
 */

import { SyncConfig, FullSyncResult } from './types';
import { FullSyncOrchestrator } from './fullSync';
import { log } from '@/lib/logger';

export class PeriodicSyncManager {
  private syncInterval: NodeJS.Timeout | null = null;
  private config: SyncConfig;
  private fullSyncOrchestrator: FullSyncOrchestrator;
  private onSyncComplete: (result: FullSyncResult) => void;

  constructor(
    config: SyncConfig,
    fullSyncOrchestrator: FullSyncOrchestrator,
    onSyncComplete: (result: FullSyncResult) => void
  ) {
    this.config = config;
    this.fullSyncOrchestrator = fullSyncOrchestrator;
    this.onSyncComplete = onSyncComplete;
  }

  /**
   * Start periodic synchronization
   */
  startPeriodicSync(): void {
    this.stopPeriodicSync(); // Clear any existing interval
    
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    
    this.syncInterval = setInterval(async () => {
      try {
        log.info(`[SyncCore] Starting scheduled sync (interval: ${this.config.intervalMinutes}m, undefined, 'periodicSync');`);
        const result = await this.fullSyncOrchestrator.performFullSync();
        this.onSyncComplete(result);
        
        if (result.success) {

        } else {
          log.error(`[SyncCore] Scheduled sync completed with errors - ${result.failedRecords} failures`, undefined, 'periodicSync');
        }
      } catch (error) {
        log.error('[SyncCore] Scheduled sync failed:', { data: error }, 'periodicSync');
        
        // Create failed sync result
        const failedResult: FullSyncResult = {
          success: false,
          totalRecords: 0,
          syncedRecords: 0,
          failedRecords: 0,
          duration: 0,
          errors: [{
            timestamp: new Date(),
            type: 'periodic_sync_error',
            message: `Scheduled sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            error
          }],
          byType: {}
        };
        
        this.onSyncComplete(failedResult);
      }
    }, intervalMs);

  }

  /**
   * Stop periodic synchronization
   */
  stopPeriodicSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;

    }
  }

  /**
   * Update sync interval
   */
  updateInterval(intervalMinutes: number): void {
    this.config.intervalMinutes = intervalMinutes;
    
    if (this.syncInterval) {
      this.startPeriodicSync(); // Restart with new interval
    }
  }

  /**
   * Check if periodic sync is active
   */
  isActive(): boolean {
    return this.syncInterval !== null;
  }

  /**
   * Get next sync time
   */
  getNextSyncTime(): Date | null {
    if (!this.syncInterval) {
      return null;
    }
    
    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    return new Date(Date.now() + intervalMs);
  }
}