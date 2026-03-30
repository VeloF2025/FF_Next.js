/**
 * Firebase to Neon ETL Pipeline - Legacy Compatibility Layer
 * 
 * @deprecated This file has been split into modular components for better maintainability.
 * 
 * New modular structure:
 * - SyncCore: Main orchestrator with sync control logic
 * - ProjectSync: Project data synchronization 
 * - ClientSync: Client analytics synchronization
 * - StaffSync: Staff performance synchronization
 * - SyncUtils: Utility functions for data transformation
 * - types.ts: Type definitions and interfaces
 * 
 * For new code, import from the specific modules or use:
 * ```typescript
 * import { SyncCore } from '@/services/sync';
 * // or
 * import SyncCore from '@/services/sync';
 * ```
 * 
 * This legacy layer maintains backward compatibility while the codebase transitions.
 */

import { SyncCore } from './syncCore';
import type { SyncConfig } from './types';

/**
 * @deprecated Use SyncCore directly for better type safety and modularity
 * 
 * Legacy wrapper class to maintain backward compatibility
 * This class delegates to the new modular architecture
 */
export class FirebaseToNeonSync {
  private syncCore: SyncCore;

  constructor(config?: Partial<SyncConfig>) {
    this.syncCore = new SyncCore(config);
  }

  /**
   * @deprecated Use syncCore.startSync() instead
   */
  async startSync(intervalMinutes: number = 15): Promise<void> {
    const config = this.syncCore.getSyncConfig();
    if (config.intervalMinutes !== intervalMinutes) {
      this.syncCore.updateConfig({ intervalMinutes });
    }
    return this.syncCore.startSync();
  }

  /**
   * @deprecated Use syncCore.stopSync() instead
   */
  async stopSync(): Promise<void> {
    return this.syncCore.stopSync();
  }

  /**
   * @deprecated Use syncCore.performFullSync() instead
   */
  async performFullSync(): Promise<void> {
    const result = await this.syncCore.performFullSync();
    if (!result.success) {
      throw new Error(`Full sync failed with ${result.errors.length} errors`);
    }
  }

  /**
   * Get sync status
   * @deprecated Use syncCore.getSyncStatus() instead
   */
  getSyncStatus() {
    return this.syncCore.getSyncStatus();
  }

  /**
   * Get sync statistics
   * @deprecated Use syncCore.getSyncStatistics() instead
   */
  async getSyncStatistics() {
    return this.syncCore.getSyncStatistics();
  }
}

/**
 * @deprecated Use new modular approach:
 * 
 * ```typescript
 * import { SyncCore } from '@/services/sync';
 * 
 * const syncCore = new SyncCore({
 *   intervalMinutes: 15,
 *   enableRealtimeSync: true,
 *   enabledSyncTypes: ['projects', 'clients', 'staff']
 * });
 * 
 * await syncCore.startSync();
 * ```
 */
export const firebaseToNeonSync = new FirebaseToNeonSync();

// Re-export new modular components for migration convenience
export { SyncCore } from './syncCore';
export { ProjectSync } from './projectSync';
export { ClientSync } from './clientSync';
export { StaffSync } from './staffSync';
export { SyncUtils } from './syncUtils';
export type * from './types';