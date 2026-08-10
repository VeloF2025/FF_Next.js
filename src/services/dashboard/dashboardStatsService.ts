/**
 * Dashboard Statistics Service
 * Provides real database statistics for dashboard components
 * ZERO mock data - all statistics from actual database sources
 *
 * NO DATABASE CLIENT HERE, deliberately. Both public methods go through
 * analyticsApi over HTTP, and this module is imported by useDashboardData — a
 * React hook — so it ships to the browser.
 *
 * It used to import `neon` from '@/lib/db-neon' behind a lazy
 * `typeof window === 'undefined'` guard. That guard prevented the client being
 * CONSTRUCTED in a browser but did nothing about the import, and webpack
 * bundles what is imported: the whole @neondatabase/serverless driver was in
 * the client chunks for /enhanced-kpis, /analytics, /dashboard, /kpi-dashboard
 * and /reports — a 144KB download for every visitor to any of them.
 *
 * Its only users were five `@deprecated` private statics with zero call sites,
 * plus the three calculate* helpers those in turn called. All eight are gone;
 * what is left is the two public methods, which have always gone through
 * analyticsApi over HTTP, and the empty-stats fallback.
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import { log } from '@/lib/logger';

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
      const stats = await analyticsApi.getDashboardStats() as unknown as DashboardStats;

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
   * Generate trend data from API
   */
  static async getDashboardTrends(): Promise<DashboardTrends> {
    try {
      // Get trends for last 30 days
      const endDate = new Date().toISOString();
      const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      
      type TrendEntry = { direction?: 'up' | 'down' | 'stable'; percentage?: number };
      const trendsData = await analyticsApi.getDashboardTrends(startDate, endDate, 'monthly') as Record<string, TrendEntry>;

      // Convert API response to DashboardTrends format
      const trends: DashboardTrends = {};
      const stats = await this.getDashboardStats();

      // Map trends from API response
      // Note: analyticsApi.fetch() unwraps data.data, so trendsData is already
      // the flat trend object { activeProjects: {value,direction,percentage}, ... }
      Object.entries(stats).forEach(([key, value]) => {
        const trendObj = trendsData?.[key];

        trends[key] = {
          value: typeof value === 'number' ? value : 0,
          direction: trendObj?.direction ?? 'stable',
          percentage: trendObj?.percentage ?? 0,
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