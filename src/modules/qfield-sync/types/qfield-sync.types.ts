/**
 * QField Sync Module Type Definitions
 * Handles synchronization between QFieldCloud and FibreFlow
 */

// Sync Status Types
export type SyncStatus = 'idle' | 'syncing' | 'completed' | 'error';
export type SyncDirection = 'qfield_to_fibreflow' | 'fibreflow_to_qfield' | 'bidirectional';
export type SyncMode = 'manual' | 'automatic' | 'scheduled';

// QFieldCloud Data Types
export interface QFieldProject {
  id: string;
  name: string;
  description: string;
  owner: string;
  isPublic: boolean;
  lastModified: string;
  layers: QFieldLayer[];
  status: 'active' | 'inactive' | 'error';
}

export interface QFieldLayer {
  id: string;
  name: string;
  type: 'point' | 'line' | 'polygon';
  featureCount: number;
  fields: QFieldField[];
  lastSync?: string;
}

export interface QFieldField {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'geometry';
  alias?: string;
  required: boolean;
}

// Fiber Cable Data from QFieldCloud
export interface QFieldFiberCable {
  featureId: string;
  cableId: string;
  cableType: string;
  cableSize: number;
  fiberCount: number;
  startPole: string;
  endPole: string;
  geometry: GeoJSONLineString;
  length: number; // Calculated from geometry
  installationStatus: 'planned' | 'in_progress' | 'completed';
  installedBy?: string;
  installationDate?: string;
  splicingComplete: boolean;
  testingComplete: boolean;
  notes?: string;
  photos?: string[];
  lastModified: string;
}

// GeoJSON Types
export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: number[][];
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: number[];
}

// Sync Configuration
export interface QFieldSyncConfig {
  qfieldcloud: {
    url: string;
    projectId: string;
    apiKey: string;
    pollingInterval: number; // in seconds
  };
  fibreflow: {
    databaseUrl: string;
    targetTable: string;
  };
  mapping: FieldMapping[];
  syncMode: SyncMode;
  syncDirection: SyncDirection;
  autoResolveConflicts: boolean;
}

// Field Mapping Configuration
export interface FieldMapping {
  source: string; // QField field name
  target: string; // FibreFlow column name
  transform?: 'none' | 'uppercase' | 'lowercase' | 'date' | 'number' | 'boolean' | 'json';
  defaultValue?: string | number | boolean | null;
}

// Sync Job Types
export interface SyncJob {
  id: string;
  type: 'fiber_cables' | 'poles' | 'splice_closures' | 'test_points';
  status: SyncStatus;
  direction: SyncDirection;
  startedAt: string;
  completedAt?: string;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  errors: SyncError[];
  duration?: number; // in milliseconds
}

export interface SyncError {
  recordId: string;
  field?: string;
  message: string;
  timestamp: string;
}

// Sync Statistics
export interface SyncStats {
  lastSync: string | null;
  totalSyncs: number;
  successfulSyncs: number;
  failedSyncs: number;
  totalRecordsSynced: number;
  averageSyncDuration: number; // in milliseconds
  nextScheduledSync?: string;
}

// Conflict Resolution
export interface SyncConflict {
  id: string;
  recordId: string;
  field: string;
  qfieldValue: unknown;
  fibreflowValue: unknown;
  detectedAt: string;
  resolution?: 'use_qfield' | 'use_fibreflow' | 'merge' | 'skip';
  resolvedAt?: string;
  resolvedBy?: string;
}

// Dashboard Display Types
export interface QFieldSyncDashboardData {
  connectionStatus: {
    qfieldcloud: 'connected' | 'disconnected' | 'error';
    fibreflow: 'connected' | 'disconnected' | 'error';
  };
  projects: QFieldProject[];
  currentJob?: SyncJob;
  recentJobs: SyncJob[];
  stats: SyncStats;
  conflicts: SyncConflict[];
  config: QFieldSyncConfig;
}

// API Response Types
export interface SyncResponse {
  success: boolean;
  data?: unknown;
  message?: string;
  errors?: SyncError[];
}

export interface ProjectListResponse {
  success: boolean;
  projects: QFieldProject[];
  timestamp: string;
}

export interface SyncHistoryResponse {
  success: boolean;
  jobs: SyncJob[];
  totalCount: number;
  page: number;
  pageSize: number;
}

// WebSocket Event Types for Real-time Updates
export interface SyncWebSocketEvent {
  type: 'sync_started' | 'sync_progress' | 'sync_completed' | 'sync_error' | 'record_synced';
  jobId: string;
  data: unknown;
  timestamp: string;
}

// Transformation Functions
export interface DataTransformer {
  qfieldToFibreflow: (data: QFieldFiberCable) => Record<string, unknown>;
  fibreflowToQfield: (data: Record<string, unknown>) => QFieldFiberCable;
}

// Validation Rules
export interface ValidationRule {
  field: string;
  type: 'required' | 'min' | 'max' | 'regex' | 'custom';
  value?: string | number | boolean | RegExp | null;
  message: string;
  validate?: (value: unknown) => boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{
    field: string;
    message: string;
  }>;
}