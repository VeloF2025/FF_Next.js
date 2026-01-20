/**
 * KPI Analytics Service
 * Handles Key Performance Indicator metrics and trends
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import type { KPIDashboardItem, KPITrend } from './types';
import { log } from '@/lib/logger';

export class KPIAnalyticsService {
  /**
   * Get KPI metrics for dashboard
   */
  async getKPIDashboard(
    projectId?: string, 
    dateFrom?: Date, 
    dateTo?: Date
  ): Promise<KPIDashboardItem[]> {
    try {
      const kpis = await analyticsApi.getKPIs();
      
      // Filter by parameters if provided
      const filteredKPIs = kpis;
      if (projectId || dateFrom || dateTo) {
        // API doesn't support these filters yet, so we'll return all KPIs
        // In a real implementation, these would be passed to the API
      }
      
      // Transform API response to match KPIDashboardItem interface
      return filteredKPIs.map(kpi => ({
        metricType: kpi.category,
        metricName: kpi.name,
        currentValue: kpi.value,
        unit: kpi.unit || '',
        recordCount: 1 // API doesn't provide record count
      }));
    } catch (error) {
      log.error('Failed to get KPI dashboard:', { data: error }, 'kpiAnalytics');
      // Return empty array instead of throwing
      return [];
    }
  }

  /**
   * Get KPI trends over time
   */
  async getKPITrends(
    metricType: string, 
    projectId?: string, 
    days: number = 30
  ): Promise<KPITrend[]> {
    try {
      // Calculate KPIs with date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const params = {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        projectId
      };
      
      // Get calculated KPIs for the metric type
      const calculatedKPIs = await analyticsApi.calculateKPIs([metricType], params);
      
      // For now, return a single data point as API doesn't provide historical trends
      // In a real implementation, the API would return time-series data
      const kpi = calculatedKPIs.data?.find((k: any) => k.id === metricType);
      
      if (kpi) {
        return [{
          date: new Date().toISOString().split('T')[0],
          value: kpi.value,
          count: 1
        }];
      }
      
      return [];
    } catch (error) {
      log.error('Failed to get KPI trends:', { data: error }, 'kpiAnalytics');
      // Return empty array instead of throwing
      return [];
    }
  }
}

// Export singleton instance
export const kpiAnalyticsService = new KPIAnalyticsService();