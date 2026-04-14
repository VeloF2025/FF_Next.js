/**
 * Project Analytics Service - Legacy Compatibility Layer
 * @deprecated Use modular components from './project-analytics' instead
 * This file maintains backward compatibility for existing imports
 * New code should import from './project-analytics' directly
 */

import {
  ProjectSummaryAnalytics,
  ProjectPerformanceAnalytics,
  ProjectTrendAnalytics,
  type ProjectSummary,
  type ProjectStatusStats,
  type ClientProjectStats,
  type MonthlyTrend,
  type BudgetAnalysis,
  type OverdueProject,
  type ProjectPerformanceMetrics,
  type TimelineData
} from './project-analytics';

/**
 * Project analytics and statistics service
 * @deprecated Use ProjectSummaryAnalytics, ProjectPerformanceAnalytics, and ProjectTrendAnalytics instead
 */
export class ProjectAnalyticsService {
  /**
   * Get project summary statistics
   * @deprecated Use ProjectSummaryAnalytics.getProjectSummary instead
   */
  static async getProjectSummary(): Promise<ProjectSummary> {
    return ProjectSummaryAnalytics.getProjectSummary();
  }

  /**
   * Get project statistics by status
   * @deprecated Use ProjectSummaryAnalytics.getProjectsByStatus instead
   */
  static async getProjectsByStatus(): Promise<ProjectStatusStats[]> {
    return ProjectSummaryAnalytics.getProjectsByStatus();
  }

  /**
   * Get project statistics by client
   * @deprecated Use ProjectSummaryAnalytics.getProjectsByClient instead
   */
  static async getProjectsByClient(): Promise<ClientProjectStats[]> {
    return ProjectSummaryAnalytics.getProjectsByClient();
  }

  /**
   * Get monthly project completion trends
   * @deprecated Use ProjectTrendAnalytics.getMonthlyCompletionTrends instead
   */
  static async getMonthlyCompletionTrends(months: number = 12): Promise<MonthlyTrend[]> {
    return ProjectTrendAnalytics.getMonthlyCompletionTrends(months);
  }

  /**
   * Get budget analysis
   * @deprecated Use ProjectTrendAnalytics.getBudgetAnalysis instead
   */
  static async getBudgetAnalysis(): Promise<BudgetAnalysis> {
    return ProjectTrendAnalytics.getBudgetAnalysis();
  }

  /**
   * Get overdue projects
   * @deprecated Use ProjectPerformanceAnalytics.getOverdueProjects instead
   */
  static async getOverdueProjects(): Promise<OverdueProject[]> {
    return ProjectPerformanceAnalytics.getOverdueProjects();
  }

  /**
   * Get project performance metrics
   * @deprecated Use ProjectPerformanceAnalytics.getProjectPerformanceMetrics instead
   */
  static async getProjectPerformanceMetrics(): Promise<ProjectPerformanceMetrics> {
    return ProjectPerformanceAnalytics.getProjectPerformanceMetrics();
  }

  /**
   * Get project timeline analysis
   * @deprecated Use ProjectTrendAnalytics.getProjectTimeline instead
   */
  static async getProjectTimeline(): Promise<TimelineData[]> {
    return ProjectTrendAnalytics.getProjectTimeline();
  }
}

// Re-export modular components for easier migration
export {
  ProjectSummaryAnalytics,
  ProjectPerformanceAnalytics,
  ProjectTrendAnalytics
} from './project-analytics';

export type { ProjectSummary } from './project-analytics';