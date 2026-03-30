/**
 * Client Sync Types
 * Type definitions for client synchronization service
 */

export interface FirebaseClientData {
  id?: string;
  name?: string;
  currentBalance?: number;
  creditLimit?: number;
  satisfactionScore?: number;
  nextFollowUpDate?: any;
  totalInteractions?: number;
  [key: string]: any;
}

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

export interface ClientEngagementMetrics {
  engagementScore: number;
  communicationFrequency: number;
  responseRate: number;
}

export interface ClientRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high';
  riskFactors: string[];
  riskScore: number;
}

export interface ClientSyncStatistics {
  totalClients: number;
  lastSyncTime: Date | null;
  avgSyncTime: number;
}

// Use SyncResult from parent types
export type { SyncResult } from '../types';