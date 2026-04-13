/**
 * Performance Analytics
 * Performance metrics and KPI calculations
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import { log } from '@/lib/logger';
import type { 
  ProjectPerformanceMetrics, 
  OverdueProject,
  PerformanceKPI,
  AnalyticsQuery
} from './analytics-types';

export class ProjectPerformanceAnalytics {
  /**
   * Get overdue projects
   */
  static async getOverdueProjects(_query?: AnalyticsQuery): Promise<OverdueProject[]> {
    try {
      // Get performance metrics including overdue projects
      const performance = await analyticsApi.getProjectPerformance('', ['overdue']);
      
      return performance.metrics?.overdue || [];
    } catch (error) {
      log.error('Error fetching overdue projects:', { data: error }, 'performance-analytics');
      return [];
    }
  }

  /**
   * Get project performance metrics
   */
  static async getProjectPerformanceMetrics(_query?: AnalyticsQuery): Promise<ProjectPerformanceMetrics> {
    try {
      // Get all performance metrics from API
      const performance = await analyticsApi.getProjectPerformance('', ['onTime', 'budget', 'quality', 'efficiency']);
      
      const metrics = performance.metrics || {};
      
      return {
        onTimeCompletionRate: metrics.onTime?.rate || 0,
        averageProjectDuration: metrics.efficiency?.avgDuration || 0,
        budgetUtilizationRate: metrics.budget?.utilizationRate || 0,
        clientSatisfactionScore: 4.2 // Placeholder - would need client feedback system
      };
    } catch (error) {
      log.error('Error fetching project performance metrics:', { data: error }, 'performance-analytics');
      return {
        onTimeCompletionRate: 0,
        averageProjectDuration: 0,
        budgetUtilizationRate: 0,
        clientSatisfactionScore: 0
      };
    }
  }

  /**
   * Get comprehensive performance KPIs
   */
  static async getPerformanceKPIs(): Promise<PerformanceKPI[]> {
    try {
      // Get KPIs from API
      const kpis = await analyticsApi.getKPIs('performance');
      
      // Transform API response to PerformanceKPI format
      return kpis.map(kpi => ({
        name: kpi.name,
        value: kpi.value,
        target: kpi.target || 0,
        trend: kpi.trend as 'up' | 'down' | 'stable',
        unit: kpi.unit || '',
        description: kpi.description || ''
      }));
    } catch (error) {
      log.error('Error calculating performance KPIs:', { data: error }, 'performance-analytics');
      return [];
    }
  }

  /**
   * Get project efficiency analysis
   */
  static async getEfficiencyAnalysis(): Promise<{
    productivity: number;
    resourceUtilization: number;
    deliverySpeed: number;
    qualityScore: number;
  }> {
    try {
      // Get efficiency metrics from API
      const performance = await analyticsApi.getProjectPerformance('', ['efficiency', 'quality']);
      const metrics = performance.metrics || {};
      
      return {
        productivity: metrics.efficiency?.productivityScore || 0,
        resourceUtilization: metrics.efficiency?.avgUtilization || 0,
        deliverySpeed: 100 - (metrics.efficiency?.avgDuration || 0), // Convert duration to speed
        qualityScore: metrics.quality?.score || 0
      };
    } catch (error) {
      log.error('Error calculating efficiency analysis:', { data: error }, 'performance-analytics');
      return {
        productivity: 0,
        resourceUtilization: 0,
        deliverySpeed: 0,
        qualityScore: 0
      };
    }
  }

  /**
   * Get risk assessment for active projects
   */
  static async getRiskAssessment(): Promise<{
    highRisk: number;
    mediumRisk: number;
    lowRisk: number;
    riskFactors: Array<{
      factor: string;
      impact: 'high' | 'medium' | 'low';
      projects: number;
    }>;
  }> {
    try {
      // Get risk metrics from API
      const performance = await analyticsApi.getProjectPerformance('', ['risk']);
      const riskMetrics = performance.metrics?.risk || {};
      
      return {
        highRisk: riskMetrics.highRisk || 0,
        mediumRisk: riskMetrics.mediumRisk || 0,
        lowRisk: riskMetrics.lowRisk || 0,
        riskFactors: [
          {
            factor: 'Deadline Pressure',
            impact: 'high',
            projects: Math.round((riskMetrics.highRisk || 0) * 0.6)
          },
          {
            factor: 'Budget Overrun',
            impact: 'medium',
            projects: Math.round((riskMetrics.mediumRisk || 0) * 0.4)
          },
          {
            factor: 'Low Progress Rate',
            impact: 'medium',
            projects: Math.round((riskMetrics.highRisk || 0) * 0.3)
          }
        ]
      };
    } catch (error) {
      log.error('Error calculating risk assessment:', { data: error }, 'performance-analytics');
      return {
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        riskFactors: []
      };
    }
  }

  /**
   * Build WHERE clause for filtering
   * @deprecated API handles filtering now
   */
  private static buildWhereClause(_query: AnalyticsQuery): string {
    return "status NOT IN ('archived', 'cancelled', 'deleted')";
  }
}