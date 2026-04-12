/**
 * Pole Tracker Service - Neon PostgreSQL
 * Handles all pole tracking operations using Neon database
 * For massive scale: 5,000 poles × 10 projects = 50,000+ poles
 */

import {
  PoleDataService,
  QualityCheckService,
  PhotoManagementService,
  StatisticsService,
  type NeonPole,
  type PoleFilters,
  type PhotoType,
  type ProjectStatistics
} from './poleTrackerNeonService/index';

export class PoleTrackerNeonService {
  private poleDataService = new PoleDataService();
  private qualityCheckService = new QualityCheckService();
  private photoManagementService = new PhotoManagementService();
  private statisticsService = new StatisticsService();

  // Pole Data Operations
  async getPolesByProject(projectId: string): Promise<NeonPole[]> {
    return this.poleDataService.getPolesByProject(projectId);
  }

  async getPoleById(id: number): Promise<NeonPole | null> {
    return this.poleDataService.getPoleById(id);
  }

  async searchPoles(filters: PoleFilters): Promise<NeonPole[]> {
    return this.poleDataService.searchPoles(filters);
  }

  async updatePoleStatus(id: number, status: string): Promise<void> {
    return this.poleDataService.updatePoleStatus(id, status);
  }

  async bulkImportPoles(projectId: string, poles: Pick<NeonPole, 'pole_number' | 'location'>[]): Promise<number> {
    return this.poleDataService.bulkImportPoles(projectId, poles);
  }

  // Quality Check Operations
  async updateQualityChecks(id: number, checks: Partial<NeonPole>): Promise<void> {
    return this.qualityCheckService.updateQualityChecks(id, checks);
  }

  // Photo Management Operations
  async uploadPolePhoto(poleId: number, photoType: PhotoType, file: File): Promise<string> {
    return this.photoManagementService.uploadPolePhoto(poleId, photoType, file);
  }

  // Statistics Operations
  async getProjectStatistics(projectId: string): Promise<ProjectStatistics> {
    return this.statisticsService.getProjectStatistics(projectId);
  }

  async getPendingSync(projectId: string): Promise<any[]> {
    return this.statisticsService.getPendingSync(projectId);
  }
}

// Export singleton instance
export const poleTrackerNeonService = new PoleTrackerNeonService();

// For backwards compatibility with existing hooks
export const poleTrackerService = {
  getAll: () => poleTrackerNeonService.searchPoles({}),
  getById: (id: string) => poleTrackerNeonService.getPoleById(parseInt(id)),
  getByProject: (projectId: string) => poleTrackerNeonService.getPolesByProject(projectId),
  create: async (_data: Record<string, unknown>) => {
    // This would need to be implemented based on your needs
    throw new Error('Create operation should use bulk import for Neon');
  },
  update: async (id: string, data: Record<string, unknown>) => {
    if (typeof data.status === 'string') {
      await poleTrackerNeonService.updatePoleStatus(parseInt(id), data.status);
    }
    // Handle other updates as needed
  },
  delete: async (id: string) => {
    // Soft delete by updating status
    await poleTrackerNeonService.updatePoleStatus(parseInt(id), 'deleted');
  },
  getStatistics: (projectId: string) => poleTrackerNeonService.getProjectStatistics(projectId),
  getPendingSync: (projectId: string) => poleTrackerNeonService.getPendingSync(projectId)
};

// Export types for external use
export type {
  NeonPole,
  PoleFilters,
  PhotoType,
  ProjectStatistics
} from './poleTrackerNeonService/index';