/**
 * BOQ Data Loader
 * Service for loading dashboard data
 */

import { BOQ, BOQStats } from '@/types/procurement/boq.types';
import { ImportStats, BOQImportService } from '@/services/procurement/boqImportService';
import { procurementApiService } from '@/services/procurement/boqApiExtensions';
import { ProcurementContext } from '@/types/procurement.types';
import { RecentActivity } from './BOQDashboardTypes';
import { log } from '@/lib/logger';

export class BOQDataLoader {
  private boqImportService: BOQImportService;

  constructor() {
    this.boqImportService = new BOQImportService();
  }

  async loadBOQStats(_context: ProcurementContext): Promise<BOQStats> {
    // This would call the actual API
    return {
      totalBOQs: 25,
      activeBOQs: 18,
      approvedBOQs: 12,
      pendingApproval: 6,
      totalItems: 3500,
      mappedItems: 3200,
      unmappedItems: 300,
      exceptionsCount: 45,
      totalValue: 2500000,
      averageValue: 100000
    };
  }

  async loadImportStats(): Promise<ImportStats> {
    return this.boqImportService.getImportStats();
  }

  async loadRecentBOQs(context: ProcurementContext): Promise<BOQ[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allBOQs = await procurementApiService.getBOQsByProject(context as any, context.projectId);
      return (allBOQs as unknown as BOQ[])
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, 5);
    } catch (error) {
      log.error('Failed to load recent BOQs:', { data: error }, 'BOQDataLoader');
      return [];
    }
  }

  async loadRecentActivity(): Promise<RecentActivity[]> {
    // Mock implementation - replace with actual API call
    return [
      {
        id: 'act1',
        type: 'upload',
        description: 'Uploaded BOQ v2.1 for Project Alpha',
        timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000),
        userId: 'john.doe@example.com',
        boqId: 'boq1'
      },
      {
        id: 'act2',
        type: 'mapping',
        description: 'Completed mapping review for BOQ v2.0',
        timestamp: new Date(Date.now() - 4 * 60 * 60 * 1000),
        userId: 'jane.smith@example.com',
        boqId: 'boq2'
      },
      {
        id: 'act3',
        type: 'approval',
        description: 'Approved BOQ v1.9 for procurement',
        timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000),
        userId: 'admin@example.com',
        boqId: 'boq3'
      }
    ];
  }

  getActiveJobs() {
    return this.boqImportService.getActiveJobs();
  }

  async loadAllDashboardData(context: ProcurementContext) {
    const [boqStats, importStats, recentBOQs, recentActivity] = await Promise.all([
      this.loadBOQStats(context),
      this.loadImportStats(),
      this.loadRecentBOQs(context),
      this.loadRecentActivity()
    ]);

    return {
      boqStats,
      importStats,
      recentBOQs,
      recentActivity,
      activeJobs: this.getActiveJobs()
    };
  }
}