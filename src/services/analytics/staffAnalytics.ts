/**
 * Staff Analytics Service
 * Handles staff performance analysis and reporting
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import type { StaffPerformanceSummary } from './types';
import { log } from '@/lib/logger';

export class StaffAnalyticsService {
  /**
   * Get staff performance summary
   */
  async getStaffPerformance(
    projectId?: string, 
    periodType: string = 'monthly'
  ): Promise<StaffPerformanceSummary[]> {
    try {
      const performance = await analyticsApi.getStaffPerformance(undefined, {
        type: periodType as any
      });
      
      // Filter by projectId if provided (API doesn't support project-level filtering yet)
      const summaryData = performance.summary || [];
      
      // Transform API response to match StaffPerformanceSummary interface
      return summaryData.map((result: any) => ({
        staffName: result.staffName,
        role: result.role || 'Staff',
        avgProductivity: result.avgProductivity,
        avgQuality: result.avgQuality,
        totalHours: result.totalHours,
        totalTasks: result.totalTasks,
        attendanceRate: result.attendanceRate || 100,
        avgSafety: result.avgSafety,
        avgEfficiency: result.avgEfficiency,
      }));
    } catch (error) {
      log.error('Failed to get staff performance:', { data: error }, 'staffAnalytics');
      throw error;
    }
  }

  /**
   * Get staff performance trends over time
   */
  async getPerformanceTrends(
    staffId: string,
    periodType: string = 'monthly',
    limit: number = 12
  ) {
    try {
      const performance = await analyticsApi.getStaffPerformance(staffId, {
        type: periodType as any
      });
      
      // Return the history data from API response
      return (performance.history || []).slice(0, limit).map((item: any) => ({
        periodStart: item.periodStart,
        periodEnd: item.periodEnd,
        productivity: item.productivity,
        qualityScore: item.qualityScore,
        safetyScore: item.safetyScore,
        efficiency: item.efficiency,
        hoursWorked: item.hoursWorked,
        tasksCompleted: item.tasksCompleted,
      }));
    } catch (error) {
      log.error('Failed to get performance trends:', { data: error }, 'staffAnalytics');
      throw error;
    }
  }

  /**
   * Get top performing staff by metric
   */
  async getTopPerformers(
    metric: 'productivity' | 'quality' | 'safety' | 'efficiency' = 'productivity',
    limit: number = 10,
    projectId?: string,
    periodType: string = 'monthly'
  ) {
    try {
      const performance = await analyticsApi.getStaffPerformance(undefined, {
        type: periodType as any
      });
      
      // Get top performers from API response
      const topPerformers = performance.topPerformers?.[metric] || [];
      
      // Transform to expected format
      return topPerformers.slice(0, limit).map((performer: any) => ({
        staffId: performer.id,
        staffName: performer.name,
        avgMetricValue: performer.score,
        totalHours: 0, // Not provided by current API
        totalTasks: 0, // Not provided by current API
      }));
    } catch (error) {
      log.error('Failed to get top performers:', { data: error }, 'staffAnalytics');
      throw error;
    }
  }
}

// Export singleton instance
export const staffAnalyticsService = new StaffAnalyticsService();