/**
 * Sync Types and Interfaces
 * Type definitions for Firebase to Neon synchronization
 */

// Sync status and control types
export interface SyncStatus {
  isRunning: boolean;
  lastSyncTime: Date | null;
  nextSyncTime: Date | null;
  syncInterval: number; // in minutes
  totalSyncs: number;
  failedSyncs: number;
  errors: SyncError[];
}

export interface SyncError {
  timestamp: Date;
  type: SyncType;
  entityId?: string;
  error: string;
  resolved: boolean;
}

export type SyncType = 'projects' | 'clients' | 'staff' | 'materials' | 'contractors';

// Sync configuration
export interface SyncConfig {
  intervalMinutes: number;
  enableRealtimeSync: boolean;
  batchSize: number;
  maxRetries: number;
  retryDelay: number; // in milliseconds
  enabledSyncTypes: SyncType[];
}

// Sync result interfaces
export interface SyncResult {
  type: SyncType;
  success: boolean;
  processedCount: number;
  errorCount: number;
  duration: number; // in milliseconds
  errors?: string[] | undefined;
}

export interface FullSyncResult {
  success: boolean;
  totalDuration: number;
  results: SyncResult[];
  summary: {
    totalProcessed: number;
    totalErrors: number;
    successRate: number;
  };
}

// Firebase data interfaces
export interface FirebaseProjectData {
  id: string;
  name?: string;
  title?: string;
  clientId?: string;
  clientName?: string;
  totalPoles?: number;
  completedPoles?: number;
  totalDrops?: number;
  completedDrops?: number;
  budget?: number;
  spentAmount?: number;
  startDate?: any; // Firebase timestamp
  endDate?: any; // Firebase timestamp
  actualEndDate?: any; // Firebase timestamp
  progress?: number;
  completion?: number;
  qualityScore?: number;
  status?: string;
  createdAt?: any;
}

export interface FirebaseClientData {
  id: string;
  name?: string;
  currentBalance?: number;
  creditLimit?: number;
  satisfactionScore?: number;
  nextFollowUpDate?: any;
  totalInteractions?: number;
}

export interface FirebaseStaffData {
  id: string;
  name?: string;
  role?: string;
  monthlyTasksCompleted?: number;
  monthlyHoursWorked?: number;
  productivityScore?: number;
  qualityScore?: number;
  attendanceRate?: number;
  monthlyOvertimeHours?: number;
  monthlyIncidents?: number;
}

// Client metrics calculation result
export interface ClientMetrics {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalRevenue: number;
  averageProjectValue: number;
  averageProjectDuration: number;
  onTimeCompletionRate: number;
  lastProjectDate: Date | null;
  lifetimeValue: number;
}

// Sync statistics
export interface SyncStatistics {
  totalSyncsPerformed: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageSyncDuration: number;
  lastSyncDuration: number;
  dataByType: Record<SyncType, {
    totalRecords: number;
    lastSynced: Date | null;
    errorCount: number;
  }>;
}

// Real-time sync event
export interface RealtimeSyncEvent {
  type: 'added' | 'modified' | 'removed';
  collection: string;
  documentId: string;
  data: any;
  timestamp: Date;
}

// Batch sync configuration
export interface BatchSyncConfig {
  batchSize: number;
  maxConcurrentBatches: number;
  delayBetweenBatches: number; // in milliseconds
  includeDeleted: boolean;
}

// Date parsing utilities result
export interface ParsedDate {
  success: boolean;
  date: Date | null;
  originalValue: any;
  parseMethod: 'toDate' | 'seconds' | 'string' | 'number' | 'null';
}