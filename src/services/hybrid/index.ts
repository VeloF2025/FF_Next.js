/**
 * Hybrid Service - Modular Export
 * Entry point for all hybrid Firebase + Neon operations
 */

import type { Project } from '@/types/project.types';
import type { Client } from '@/types/client.types';

// Export Firebase services
export { FirebaseProjectService, FirebaseClientService } from './firebase';

// Export Neon analytics service
export { NeonAnalyticsService } from './neon';

// Export coordinator - commented out due to missing file
// export { HybridCoordinator } from './coordinator';

/**
 * Internal shape of the unimplemented coordinator dependencies.
 * These properties are never populated in the mock — methods always throw at runtime.
 */
interface CoordinatorDeps {
  firebaseProjects: {
    getAllProjects: () => Promise<Project[]>;
    getProjectById: (id: string) => Promise<Project | null>;
    subscribeToProject: (id: string, callback: (project: Project | null) => void) => () => void;
    subscribeToProjects: (callback: (projects: Project[]) => void) => () => void;
  };
  firebaseClients: {
    getAllClients: () => Promise<Client[]>;
    getClientById: (id: string) => Promise<Client | null>;
  };
  neonAnalytics: {
    getProjectAnalytics: (projectId?: string) => Promise<unknown>;
    getProjectTrends: (dateFrom: Date, dateTo: Date) => Promise<unknown>;
    recordKPI: (projectId: string, metricType: string, metricName: string, value: number, unit?: string) => Promise<void>;
    getClientAnalytics: (clientId?: string) => Promise<unknown>;
    getTopClients: (limit?: number) => Promise<unknown>;
  };
}

// 🔵 MOCK: HybridCoordinator — placeholder for missing coordinator implementation
export class HybridCoordinator {
  // Mock implementation — coordinator.ts is not yet implemented
}

// Legacy service classes for backward compatibility
export class HybridProjectService extends HybridCoordinator {
  // ============================================
  // REAL-TIME OPERATIONS (Firebase)
  // ============================================

  async getAllProjects(): Promise<Project[]> {
    return (this as unknown as CoordinatorDeps).firebaseProjects.getAllProjects();
  }

  async getProjectById(id: string): Promise<Project | null> {
    return (this as unknown as CoordinatorDeps).firebaseProjects.getProjectById(id);
  }

  subscribeToProject(id: string, callback: (project: Project | null) => void): () => void {
    return (this as unknown as CoordinatorDeps).firebaseProjects.subscribeToProject(id, callback);
  }

  subscribeToProjects(callback: (projects: Project[]) => void): () => void {
    return (this as unknown as CoordinatorDeps).firebaseProjects.subscribeToProjects(callback);
  }

  // ============================================
  // ANALYTICS OPERATIONS (Neon)
  // ============================================

  async getProjectAnalytics(projectId?: string): Promise<unknown> {
    return (this as unknown as CoordinatorDeps).neonAnalytics.getProjectAnalytics(projectId);
  }

  async getProjectTrends(dateFrom: Date, dateTo: Date): Promise<unknown> {
    return (this as unknown as CoordinatorDeps).neonAnalytics.getProjectTrends(dateFrom, dateTo);
  }

  async recordKPI(projectId: string, metricType: string, metricName: string, value: number, unit: string = ''): Promise<void> {
    return (this as unknown as CoordinatorDeps).neonAnalytics.recordKPI(projectId, metricType, metricName, value, unit);
  }
}

export class HybridClientService extends HybridCoordinator {
  async getAllClients(): Promise<Client[]> {
    return (this as unknown as CoordinatorDeps).firebaseClients.getAllClients();
  }

  async getClientById(id: string): Promise<Client | null> {
    return (this as unknown as CoordinatorDeps).firebaseClients.getClientById(id);
  }

  async getClientAnalytics(clientId?: string): Promise<unknown> {
    return (this as unknown as CoordinatorDeps).neonAnalytics.getClientAnalytics(clientId);
  }

  async getTopClients(limit: number = 10): Promise<unknown> {
    return (this as unknown as CoordinatorDeps).neonAnalytics.getTopClients(limit);
  }
}

// Export service instances for backward compatibility
export const hybridProjectService = new HybridProjectService();
export const hybridClientService = new HybridClientService();
