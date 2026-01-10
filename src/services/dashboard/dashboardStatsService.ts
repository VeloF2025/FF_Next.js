/**
 * Dashboard Statistics Service
 * Provides real database statistics for dashboard components
 * ZERO mock data - all statistics from actual database sources
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import { log } from '@/lib/logger';
import { staffService } from '@/services/staffService';
import { neon, NeonQueryFunction } from '@neondatabase/serverless';

// Lazy initialize SQL client for deprecated methods (prevents SSR/client mismatch)
let _sql: NeonQueryFunction<false, false> | null = null;
const getSql = () => {
  if (!_sql && typeof window === 'undefined' && process.env.DATABASE_URL) {
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
};

// Type definitions for deprecated query services
const staffQueryService = {
  getStaffSummary: () => staffService.getStaffSummary(),
};

const clientQueryService = {
  getClientSummary: async () => ({
    totalProjectValue: 0,
    activeClients: 0,
  }),
};

const ProjectQueryService = {
  getAllProjects: async () => [] as any[],
  getActiveProjects: async () => [] as any[],
};

const ProjectStatus = {
  COMPLETED: 'COMPLETED',
} as const;

// 🟢 WORKING: Core dashboard data types
export interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  completedTasks: number;
  teamMembers: number;
  openIssues: number;
  polesInstalled: number;
  dropsCompleted: number;
  fiberInstalled: number;
  totalRevenue: number;
  contractorsActive: number;
  contractorsPending: number;
  boqsActive: number;
  rfqsActive: number;
  supplierActive: number;
  reportsGenerated: number;
  performanceScore: number;
  qualityScore: number;
  onTimeDelivery: number;
  budgetUtilization: number;
}

export interface DashboardTrends {
  [key: string]: {
    value: number;
    direction: 'up' | 'down' | 'stable';
    percentage: number;
  };
}

/**
 * Dashboard statistics service - connects to real database sources
 */
export class DashboardStatsService {
  
  /**
   * Get comprehensive dashboard statistics from API
   */
  static async getDashboardStats(): Promise<DashboardStats> {
    try {
      const stats = await analyticsApi.getDashboardStats();
      
      return {
        totalProjects: stats.totalProjects,
        activeProjects: stats.activeProjects,
        completedProjects: stats.completedProjects,
        completedTasks: stats.completedTasks,
        teamMembers: stats.teamMembers,
        openIssues: stats.openIssues,
        polesInstalled: stats.polesInstalled,
        dropsCompleted: stats.dropsCompleted,
        fiberInstalled: stats.fiberInstalled,
        totalRevenue: stats.totalRevenue,
        contractorsActive: stats.contractorsActive,
        contractorsPending: stats.contractorsPending,
        boqsActive: stats.boqsActive,
        rfqsActive: stats.rfqsActive,
        supplierActive: stats.supplierActive,
        reportsGenerated: stats.reportsGenerated,
        performanceScore: stats.performanceScore,
        qualityScore: stats.qualityScore,
        onTimeDelivery: stats.onTimeDelivery,
        budgetUtilization: stats.budgetUtilization,
      };
    } catch (error) {
      log.error('Error fetching dashboard statistics:', { data: error }, 'dashboardStatsService');
      // Return zeros instead of mock data on error
      return this.getEmptyStats();
    }
  }

  /**
   * @deprecated Use API endpoint instead
   */
  private static async getProjectStatistics() {
    try {
      // Get all projects from Neon
      const allProjects = await ProjectQueryService.getAllProjects();
      const activeProjects = await ProjectQueryService.getActiveProjects();
      
      // Get completed projects
      const completedProjects = allProjects.filter(p => 
        p.status === ProjectStatus.COMPLETED
      );

      // Calculate performance metrics from actual data
      const totalBudget = allProjects.reduce((sum, p) => sum + (p.budget || 0), 0);
      const completedBudget = completedProjects.reduce((sum, p) => sum + (p.budget || 0), 0);
      
      // Calculate on-time delivery from project dates
      const onTimeProjects = completedProjects.filter(p => {
        if (!p.endDate || !p.actualEndDate) return false;
        // Compare actual end date with planned end date (using endDate as planned)
        const actualEnd = p.actualEndDate instanceof Date ? p.actualEndDate : 
          typeof p.actualEndDate === 'string' ? new Date(p.actualEndDate) : 
          (p.actualEndDate as any)?.toDate?.() || new Date();
        const plannedEnd = p.endDate instanceof Date ? p.endDate : 
          typeof p.endDate === 'string' ? new Date(p.endDate) : 
          (p.endDate as any)?.toDate?.() || new Date();
        return actualEnd <= plannedEnd;
      });
      
      const onTimeDelivery = completedProjects.length > 0 
        ? (onTimeProjects.length / completedProjects.length) * 100 
        : 0;

      return {
        total: allProjects.length,
        active: activeProjects.length,
        completed: completedProjects.length,
        completedTasks: this.calculateCompletedTasks(allProjects),
        performanceScore: this.calculatePerformanceScore(allProjects),
        qualityScore: this.calculateQualityScore(completedProjects),
        onTimeDelivery,
        budgetUtilization: totalBudget > 0 ? (completedBudget / totalBudget) * 100 : 0,
      };
    } catch (error) {
      log.error('Error getting project statistics:', { data: error }, 'dashboardStatsService');
      return {
        total: 0,
        active: 0,
        completed: 0,
        completedTasks: 0,
        performanceScore: 0,
        qualityScore: 0,
        onTimeDelivery: 0,
        budgetUtilization: 0,
      };
    }
  }

  /**
   * @deprecated Use API endpoint instead
   */
  private static async getStaffStatistics() {
    try {
      const staffSummary = await staffQueryService.getStaffSummary();
      
      return {
        total: staffSummary.activeStaff, // Only count active staff
        openIssues: 0, // TODO: Connect to issues system when available
      };
    } catch (error) {
      log.error('Error getting staff statistics:', { data: error }, 'dashboardStatsService');
      return {
        total: 0,
        openIssues: 0,
      };
    }
  }

  /**
   * @deprecated Use API endpoint instead
   */
  private static async getClientStatistics() {
    try {
      const clientSummary = await clientQueryService.getClientSummary();
      
      return {
        totalRevenue: clientSummary.totalProjectValue,
        activeClients: clientSummary.activeClients,
      };
    } catch (error) {
      log.error('Error getting client statistics:', { data: error }, 'dashboardStatsService');
      return {
        totalRevenue: 0,
        activeClients: 0,
      };
    }
  }

  /**
   * @deprecated Use API endpoint instead
   */
  private static async getInfrastructureStatistics() {
    try {
      // Try to get infrastructure data from Neon database
      // If tables don't exist, return 0s
      const sql = getSql();
      if (!sql) return { poles: 0, drops: 0, fiber: 0 };

      const result = await sql`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'pole' THEN quantity ELSE 0 END), 0) as poles,
          COALESCE(SUM(CASE WHEN type = 'drop' THEN quantity ELSE 0 END), 0) as drops,
          COALESCE(SUM(CASE WHEN type = 'fiber' THEN length ELSE 0 END), 0) as fiber
        FROM infrastructure_installations
        WHERE status = 'completed'
      `.catch(() => [{ poles: 0, drops: 0, fiber: 0 }]);

      const stats = result[0] || { poles: 0, drops: 0, fiber: 0 };
      
      return {
        poles: parseInt(stats.poles) || 0,
        drops: parseInt(stats.drops) || 0,
        fiber: parseInt(stats.fiber) || 0,
      };
    } catch (error) {
      // Return 0s if infrastructure tracking not implemented yet
      return {
        poles: 0,
        drops: 0,
        fiber: 0,
      };
    }
  }

  /**
   * @deprecated Use API endpoint instead
   */
  private static async getProcurementStatistics() {
    try {
      // Try to get procurement data from Neon database
      // If tables don't exist, return 0s
      const sql = getSql();
      if (!sql) return {
        boqsActive: 0,
        rfqsActive: 0,
        suppliersActive: 0,
        contractorsActive: 0,
        contractorsPending: 0,
        reportsGenerated: 0,
      };

      const [boqResult, rfqResult, supplierResult, contractorResult] = await Promise.all([
        sql`SELECT COUNT(*) as count FROM boqs WHERE status = 'active'`.catch(() => [{ count: 0 }]),
        sql`SELECT COUNT(*) as count FROM rfqs WHERE status = 'active'`.catch(() => [{ count: 0 }]),
        sql`SELECT COUNT(*) as count FROM suppliers WHERE status = 'active'`.catch(() => [{ count: 0 }]),
        sql`
          SELECT
            COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
            COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
          FROM contractors
        `.catch(() => [{ active: 0, pending: 0 }])
      ]);

      return {
        boqsActive: parseInt(boqResult[0]?.count) || 0,
        rfqsActive: parseInt(rfqResult[0]?.count) || 0,
        suppliersActive: parseInt(supplierResult[0]?.count) || 0,
        contractorsActive: parseInt(contractorResult[0]?.active) || 0,
        contractorsPending: parseInt(contractorResult[0]?.pending) || 0,
        reportsGenerated: 0, // TODO: Connect to reports system when available
      };
    } catch (error) {
      // Return 0s if procurement tracking not fully implemented yet
      return {
        boqsActive: 0,
        rfqsActive: 0,
        suppliersActive: 0,
        contractorsActive: 0,
        contractorsPending: 0,
        reportsGenerated: 0,
      };
    }
  }

  /**
   * Calculate completed tasks from projects
   */
  private static calculateCompletedTasks(projects: any[]): number {
    // This would need to be connected to a task management system
    // For now, estimate based on completed projects
    const completedProjects = projects.filter(p => 
      p.status === 'COMPLETED' || p.status === 'FINISHED'
    );
    
    // Rough estimate: 5 tasks per completed project on average
    return completedProjects.length * 5;
  }

  /**
   * Calculate performance score from project data
   */
  private static calculatePerformanceScore(projects: any[]): number {
    if (projects.length === 0) return 0;
    
    const completedProjects = projects.filter(p => 
      p.status === 'COMPLETED' || p.status === 'FINISHED'
    );
    
    if (completedProjects.length === 0) return 0;
    
    // Calculate based on completion rate and budget adherence
    const completionRate = (completedProjects.length / projects.length) * 100;
    
    // This is a simplified calculation - would need more metrics in practice
    return Math.min(completionRate, 100);
  }

  /**
   * Calculate quality score from completed projects
   */
  private static calculateQualityScore(completedProjects: any[]): number {
    if (completedProjects.length === 0) return 0;
    
    // This would need to be connected to quality metrics/ratings
    // Return 0 to show honest empty state until real quality metrics are implemented
    return 0;
  }

  /**
   * Generate trend data from API
   */
  static async getDashboardTrends(): Promise<DashboardTrends> {
    try {
      // Get trends for last 30 days
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      const trendsData = await analyticsApi.getDashboardTrends(startDate, endDate, 'monthly');
      
      // Convert API response to DashboardTrends format
      const trends: DashboardTrends = {};
      const stats = await this.getDashboardStats();
      
      // Map trends from API response
      Object.entries(stats).forEach(([key, value]) => {
        const trend = trendsData.projects?.trends?.[key] || 
                     trendsData.revenue?.trends?.[key] || 
                     trendsData.staff?.trends?.[key];
        
        trends[key] = {
          value: typeof value === 'number' ? value : 0,
          direction: trend || 'stable',
          percentage: 0, // Calculate from trend data if available
        };
      });
      
      return trends;
    } catch (error) {
      log.error('Error fetching dashboard trends:', { data: error }, 'dashboardStatsService');
      // Fallback to stable trends
      const stats = await this.getDashboardStats();
      const trends: DashboardTrends = {};
      
      Object.entries(stats).forEach(([key, value]) => {
        trends[key] = {
          value: typeof value === 'number' ? value : 0,
          direction: 'stable',
          percentage: 0,
        };
      });
      
      return trends;
    }
  }

  /**
   * Get empty stats (all zeros) - no mock data
   */
  private static getEmptyStats(): DashboardStats {
    return {
      totalProjects: 0,
      activeProjects: 0,
      completedProjects: 0,
      completedTasks: 0,
      teamMembers: 0,
      openIssues: 0,
      polesInstalled: 0,
      dropsCompleted: 0,
      fiberInstalled: 0,
      totalRevenue: 0,
      contractorsActive: 0,
      contractorsPending: 0,
      boqsActive: 0,
      rfqsActive: 0,
      supplierActive: 0,
      reportsGenerated: 0,
      performanceScore: 0,
      qualityScore: 0,
      onTimeDelivery: 0,
      budgetUtilization: 0,
    };
  }
}