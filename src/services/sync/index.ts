/**
 * Firebase to Neon Sync Module
 * Modular synchronization system for Firebase to Neon PostgreSQL data pipeline
 */

// Core orchestration
export { SyncCore } from './syncCore';

// Specialized sync services
export { ProjectSync } from './projectSync';
export { ClientSync } from './clientSync';
export { StaffSync } from './staffSync';

// Utilities and helpers
export { SyncUtils } from './syncUtils';

// Type definitions
export type {
  // Sync control types
  SyncStatus,
  SyncError,
  SyncType,
  SyncConfig,
  
  // Result types
  SyncResult,
  FullSyncResult,
  SyncStatistics,
  
  // Firebase data types
  FirebaseProjectData,
  FirebaseClientData,
  FirebaseStaffData,
  
  // Metric calculation types
  ClientMetrics,
  ParsedDate,
  
  // Real-time sync types
  RealtimeSyncEvent,
  BatchSyncConfig
} from './types';

// Legacy compatibility - maintain backward compatibility
export { FirebaseToNeonSync } from './firebaseToNeonSync';

// Default export - recommended usage
export { SyncCore as default } from './syncCore';