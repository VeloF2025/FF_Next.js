/**
 * Sync Core Types and Interfaces
 */

export interface SyncConfig {
  intervalMinutes: number;
  enableRealtimeSync: boolean;
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  enabledSyncTypes: string[];
}

export interface SyncStatus {
  isRunning: boolean;
  lastSyncTime: Date | null;
  nextSyncTime: Date | null;
  syncInterval: number;
  totalSyncs: number;
  failedSyncs: number;
  errors: SyncError[];
}

export interface FullSyncResult {
  success: boolean;
  totalRecords: number;
  syncedRecords: number;
  failedRecords: number;
  duration: number;
  errors: SyncError[];
  byType: {
    [key: string]: {
      synced: number;
      failed: number;
      errors: SyncError[];
    };
  };
}

export interface SyncError {
  timestamp: Date;
  type: string;
  message: string;
  entityId?: string;
  entityType?: string;
  error?: any;
}

export interface RealtimeSyncEvent {
  type: 'added' | 'modified' | 'removed';
  entityType: string;
  entityId: string;
  data?: any;
  timestamp: Date;
}

export interface SyncStatistics {
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageSyncDuration: number;
  lastSyncTime: Date | null;
  uptime: number;
  errorRate: number;
  syncTypes: {
    [key: string]: {
      totalSyncs: number;
      successCount: number;
      failureCount: number;
      lastSyncTime: Date | null;
      averageDuration: number;
    };
  };
  recentErrors: SyncError[];
  performance: {
    recordsPerSecond: number;
    peakSyncTime: number;
    averageRecordsPerSync: number;
  };
}