/**
 * Sync Core Orchestrator
 * Main coordination service that manages all sync operations
 */

import { SyncConfig, SyncStatus, FullSyncResult, SyncError, RealtimeSyncEvent } from './types';
import { SyncConfigManager } from './config';
import { RealtimeSyncManager } from './realtimeSync';
import { PeriodicSyncManager } from './periodicSync';
import { FullSyncOrchestrator } from './fullSync';
import { SyncStatisticsManager } from './statistics';
import { log } from '@/lib/logger';

export class SyncCoreOrchestrator {
  private isRunning = false;
  private syncStatus: SyncStatus;
  private config: SyncConfig;
  private realtimeSyncManager: RealtimeSyncManager;
  private periodicSyncManager: PeriodicSyncManager;
  private fullSyncOrchestrator: FullSyncOrchestrator;
  private statisticsManager: SyncStatisticsManager;

  constructor(config?: Partial<SyncConfig>) {
    this.config = SyncConfigManager.mergeConfig(config);
    this.syncStatus = SyncConfigManager.initializeSyncStatus(this.config);
    
    // Initialize managers
    this.fullSyncOrchestrator = new FullSyncOrchestrator(this.config);
    this.statisticsManager = new SyncStatisticsManager();
    
    this.realtimeSyncManager = new RealtimeSyncManager(
      this.config,
      (error) => this.addSyncError(error),
      (event) => this.handleRealtimeSyncEvent(event)
    );
    
    this.periodicSyncManager = new PeriodicSyncManager(
      this.config,
      this.fullSyncOrchestrator,
      (result) => this.handleSyncComplete(result)
    );
  }

  /**
   * Start synchronization services
   */
  async startSync(): Promise<void> {
    if (this.isRunning) {
      log.warn('[SyncCore] Sync is already running', undefined, 'orchestrator');
      return;
    }

    this.isRunning = true;
    this.syncStatus.isRunning = true;

    try {
      // Start real-time sync
      if (this.config.enableRealtimeSync) {
        this.realtimeSyncManager.setupRealtimeSync();

      }

      // Start periodic sync
      this.periodicSyncManager.startPeriodicSync();
      this.updateNextSyncTime();

      // Perform initial full sync

      const initialSyncResult = await this.fullSyncOrchestrator.performFullSync();
      this.handleSyncComplete(initialSyncResult);

    } catch (error) {
      log.error('[SyncCore] Failed to start sync services:', { data: error }, 'orchestrator');
      await this.stopSync();
      throw error;
    }
  }

  /**
   * Stop synchronization services
   */
  async stopSync(): Promise<void> {
    if (!this.isRunning) {
      log.warn('[SyncCore] Sync is not running', undefined, 'orchestrator');
      return;
    }

    // Stop real-time sync
    this.realtimeSyncManager.stopRealtimeSync();
    
    // Stop periodic sync
    this.periodicSyncManager.stopPeriodicSync();

    this.isRunning = false;
    this.syncStatus.isRunning = false;
    this.syncStatus.nextSyncTime = null;

  }

  /**
   * Perform manual full synchronization
   */
  async performFullSync(): Promise<FullSyncResult> {

    const result = await this.fullSyncOrchestrator.performFullSync();
    this.handleSyncComplete(result);
    return result;
  }

  /**
   * Get current sync status
   */
  getSyncStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /**
   * Get sync statistics
   */
  async getSyncStatistics() {
    return this.statisticsManager.getSyncStatistics();
  }

  /**
   * Update sync configuration
   */
  updateConfig(updates: Partial<SyncConfig>): void {
    this.config = SyncConfigManager.updateConfig(this.config, updates);
    this.syncStatus.syncInterval = this.config.intervalMinutes;
    
    // Update periodic sync interval if running
    if (this.isRunning) {
      this.periodicSyncManager.updateInterval(this.config.intervalMinutes);
      this.updateNextSyncTime();
    }
  }

  /**
   * Get current sync configuration
   */
  getSyncConfig(): SyncConfig {
    return { ...this.config };
  }

  /**
   * Handle sync completion
   */
  private handleSyncComplete(result: FullSyncResult): void {
    this.syncStatus.lastSyncTime = new Date();
    this.syncStatus.totalSyncs++;
    
    if (!result.success) {
      this.syncStatus.failedSyncs++;
    }

    // Add errors to status
    result.errors.forEach(error => this.addSyncError(error));

    // Update statistics
    this.statisticsManager.addSyncResult(result);
    
    this.updateNextSyncTime();
  }

  /**
   * Handle real-time sync events
   */
  private handleRealtimeSyncEvent(_event: RealtimeSyncEvent): void {

  }

  /**
   * Add sync error to status
   */
  private addSyncError(error: SyncError): void {
    this.syncStatus.errors.push(error);
    
    // Keep only last 50 errors
    if (this.syncStatus.errors.length > 50) {
      this.syncStatus.errors = this.syncStatus.errors.slice(-50);
    }
  }

  /**
   * Update next sync time
   */
  private updateNextSyncTime(): void {
    this.syncStatus.nextSyncTime = this.periodicSyncManager.getNextSyncTime();
  }
}