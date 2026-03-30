/**
 * Sync Configuration Management
 */

import { SyncConfig, SyncStatus } from './types';

export class SyncConfigManager {
  /**
   * Get default sync configuration
   */
  static getDefaultConfig(): SyncConfig {
    return {
      intervalMinutes: 15,
      enableRealtimeSync: true,
      batchSize: 50,
      maxRetries: 3,
      retryDelay: 1000,
      enabledSyncTypes: ['projects', 'clients', 'staff']
    };
  }

  /**
   * Initialize sync status
   */
  static initializeSyncStatus(config: SyncConfig): SyncStatus {
    return {
      isRunning: false,
      lastSyncTime: null,
      nextSyncTime: null,
      syncInterval: config.intervalMinutes,
      totalSyncs: 0,
      failedSyncs: 0,
      errors: []
    };
  }

  /**
   * Merge user config with defaults
   */
  static mergeConfig(userConfig?: Partial<SyncConfig>): SyncConfig {
    return {
      ...this.getDefaultConfig(),
      ...userConfig
    };
  }

  /**
   * Validate sync configuration
   */
  static validateConfig(config: SyncConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.intervalMinutes < 1) {
      errors.push('intervalMinutes must be at least 1');
    }

    if (config.batchSize < 1) {
      errors.push('batchSize must be at least 1');
    }

    if (config.maxRetries < 0) {
      errors.push('maxRetries must be non-negative');
    }

    if (config.retryDelay < 0) {
      errors.push('retryDelay must be non-negative');
    }

    if (!Array.isArray(config.enabledSyncTypes) || config.enabledSyncTypes.length === 0) {
      errors.push('enabledSyncTypes must be a non-empty array');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Update sync configuration
   */
  static updateConfig(currentConfig: SyncConfig, updates: Partial<SyncConfig>): SyncConfig {
    const newConfig = { ...currentConfig, ...updates };
    const validation = this.validateConfig(newConfig);
    
    if (!validation.valid) {
      throw new Error(`Invalid sync configuration: ${validation.errors.join(', ')}`);
    }

    return newConfig;
  }
}