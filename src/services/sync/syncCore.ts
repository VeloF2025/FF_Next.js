/**
 * Sync Core - Legacy Compatibility Layer
 * @deprecated Use './core' modular components instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './core' directly
 */

// Re-export everything from the modular structure
export * from './core';

// Import services for legacy class compatibility
import { 
  SyncCoreOrchestrator,
  SyncConfig,
  SyncStatus,
  FullSyncResult,
  SyncStatistics
} from './core';

/**
 * Core synchronization orchestrator
 * @deprecated Use SyncCoreOrchestrator from './core' instead
 */
export class SyncCore {
  private orchestrator: SyncCoreOrchestrator;

  constructor(config?: Partial<SyncConfig>) {
    this.orchestrator = new SyncCoreOrchestrator(config);
  }

  /**
   * Start synchronization services
   * @deprecated Use SyncCoreOrchestrator.startSync() instead
   */
  async startSync(): Promise<void> {
    return this.orchestrator.startSync();
  }

  /**
   * Stop synchronization services
   * @deprecated Use SyncCoreOrchestrator.stopSync() instead
   */
  async stopSync(): Promise<void> {
    return this.orchestrator.stopSync();
  }

  /**
   * Perform manual full synchronization
   * @deprecated Use SyncCoreOrchestrator.performFullSync() instead
   */
  async performFullSync(): Promise<FullSyncResult> {
    return this.orchestrator.performFullSync();
  }

  /**
   * Get current sync status
   * @deprecated Use SyncCoreOrchestrator.getSyncStatus() instead
   */
  getSyncStatus(): SyncStatus {
    return this.orchestrator.getSyncStatus();
  }

  /**
   * Get sync statistics
   * @deprecated Use SyncCoreOrchestrator.getSyncStatistics() instead
   */
  async getSyncStatistics(): Promise<SyncStatistics> {
    return this.orchestrator.getSyncStatistics();
  }

  /**
   * Update sync configuration
   * @deprecated Use SyncCoreOrchestrator.updateConfig() instead
   */
  updateConfig(updates: Partial<SyncConfig>): void {
    this.orchestrator.updateConfig(updates);
  }

  /**
   * Get current sync configuration
   * @deprecated Use SyncCoreOrchestrator.getSyncConfig() instead
   */
  getSyncConfig(): SyncConfig {
    return this.orchestrator.getSyncConfig();
  }
}

// Default export for backward compatibility
export { SyncCoreOrchestrator as default } from './core';