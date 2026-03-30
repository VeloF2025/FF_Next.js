/**
 * Client Synchronization - Legacy Compatibility Layer
 * @deprecated Use modular components from './client' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './client' directly
 */

// Re-export everything from the modular structure
export { ClientSync } from './client';
export type {
  FirebaseClientData,
  ClientMetrics,
  ClientEngagementMetrics,
  ClientRiskAssessment,
  ClientSyncStatistics,
  SyncResult
} from './client';