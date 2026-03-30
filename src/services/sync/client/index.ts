/**
 * Client Sync Module - Clean Exports
 * Modular client synchronization service
 */

// Export types
export type {
  FirebaseClientData,
  ClientMetrics,
  ClientEngagementMetrics,
  ClientRiskAssessment,
  ClientSyncStatistics,
  SyncResult
} from './types';

// Import core services
import { ClientSyncCore } from './clientSyncCore';
import { ClientMetricsCalculator } from './metrics';
import { ClientClassification } from './classification';
import { ClientDataAccess } from './dataAccess';

// Export core services
export { ClientSyncCore } from './clientSyncCore';
export { ClientMetricsCalculator } from './metrics';
export { ClientClassification } from './classification';
export { ClientDataAccess } from './dataAccess';

// Main ClientSync class combining all functionality
export class ClientSync {
  // Core sync methods
  static syncAllClients = ClientSyncCore.syncAllClients;
  static syncSingleClient = ClientSyncCore.syncSingleClient;
  
  // Metrics methods
  static calculateClientMetrics = ClientMetricsCalculator.calculateMetrics;
  static calculatePaymentScore = ClientMetricsCalculator.calculatePaymentScore;
  static calculateLifetimeValue = ClientMetricsCalculator.calculateLifetimeValue;
  static calculateOnTimeDelivery = ClientMetricsCalculator.calculateOnTimeDelivery;
  
  // Classification methods
  static classifyClient = ClientClassification.classifyClient;
  static calculateEngagementMetrics = ClientClassification.calculateEngagementMetrics;
  static assessClientRisk = ClientClassification.assessClientRisk;
  
  // Data access methods
  static getSyncStatistics = ClientDataAccess.getSyncStatistics;
}