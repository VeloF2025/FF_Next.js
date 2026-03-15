/**
 * Client Summary and Analytics Types
 * Summary statistics and metrics interfaces
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

import { Client } from './core.types';

export interface ClientSummary {
  totalClients: number;
  activeClients: number;
  prospectClients: number;
  inactiveClients: number;
  totalProjectValue: number;
  averageProjectValue: number;
  topClientsByValue: Client[];
  clientsByCategory: { [key: string]: number };
  clientsByStatus: { [key: string]: number };
  clientsByPriority: { [key: string]: number };
  monthlyGrowth: number;
  conversionRate: number;
}

export interface ClientMetrics {
  clientId: string;
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  totalProjectValue: number;
  averageProjectValue: number;
  lastProjectDate?: Timestamp;
  averageProjectDuration: number;
  onTimeCompletionRate: number;
}