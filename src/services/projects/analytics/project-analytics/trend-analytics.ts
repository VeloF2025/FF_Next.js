/**
 * Trend Analytics
 * Time-based trends and timeline analysis
 */

import { analyticsApi } from '@/services/api/analyticsApi';
import { log } from '@/lib/logger';
import type { 
  MonthlyTrend, 
  BudgetAnalysis, 
  TimelineData,
  AnalyticsQuery
} from './analytics-types';

export class ProjectTrendAnalytics {
  /**
   * Get monthly project completion trends
   */
  static async getMonthlyCompletionTrends(months: number = 12): Promise<MonthlyTrend[]> {
    try {
      const endDate = new Date().toISOString();
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - months);
      
      const trends = await analyticsApi.getProjectTrends('', {
        type: 'monthly',
        startDate: startDate.toISOString(),
        endDate
      });
      
      return trends.trends?.map((t: any) => ({
        month: t.month,
        completed: t.completedProjects || 0,
        started: t.newProjects || 0
      })) || [];
    } catch (error) {
      log.error('Error fetching monthly completion trends:', { data: error }, 'trend-analytics');
      return [];
    }
  }

  /**
   * Get budget analysis and trends
   */
  static async getBudgetAnalysis(query?: AnalyticsQuery): Promise<BudgetAnalysis> {
    try {
      const budgetData = await analyticsApi.getBudgetAnalysis(
        query?.projectId,
        query?.clientId,
        query?.department
      );
      
      return {
        totalBudget: budgetData.totalBudget || 0,
        averageBudget: budgetData.averageBudget || 0,
        budgetByStatus: budgetData.budgetByStatus || []
      };
    } catch (error) {
      log.error('Error fetching budget analysis:', { data: error }, 'trend-analytics');
      return {
        totalBudget: 0,
        averageBudget: 0,
        budgetByStatus: []
      };
    }
  }

  /**
   * Get project timeline analysis
   */
  static async getProjectTimeline(weeksAhead: number = 52): Promise<TimelineData[]> {
    try {
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + (weeksAhead * 7));
      
      const trendsData = await analyticsApi.getProjectTrends('', {
        type: 'weekly',
        startDate: new Date().toISOString(),
        endDate: endDate.toISOString()
      });
      
      // Transform API response to timeline data
      return trendsData.timeline?.map((item: any) => ({
        date: item.date,
        projectsStarting: item.projectsStarting || 0,
        projectsEnding: item.projectsEnding || 0,
        milestones: item.milestones || 0
      })) || [];
    } catch (error) {
      log.error('Error fetching project timeline:', { data: error }, 'trend-analytics');
      return [];
    }
  }

  /**
   * Get quarterly trends
   */
  static async getQuarterlyTrends(quarters: number = 4): Promise<Array<{
    quarter: string;
    projectsCompleted: number;
    totalBudget: number;
    averageProgress: number;
    clientCount: number;
  }>> {
    try {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - (quarters * 3));
      
      const trendsData = await analyticsApi.getProjectTrends('', {
        type: 'quarterly',
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      });
      
      return trendsData.quarters?.map((q: any) => ({
        quarter: q.quarter,
        projectsCompleted: q.projectsCompleted || 0,
        totalBudget: q.totalBudget || 0,
        averageProgress: q.averageProgress || 0,
        clientCount: q.clientCount || 0
      })) || [];
    } catch (error) {
      log.error('Error fetching quarterly trends:', { data: error }, 'trend-analytics');
      return [];
    }
  }

  /**
   * Get year-over-year comparison
   */
  static async getYearOverYearComparison(): Promise<{
    currentYear: {
      projects: number;
      budget: number;
      completed: number;
    };
    previousYear: {
      projects: number;
      budget: number;
      completed: number;
    };
    growth: {
      projects: number;
      budget: number;
      completed: number;
    };
  }> {
    try {
      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;

      // Get data for current year
      const currentYearData = await analyticsApi.getProjectTrends('', {
        type: 'yearly',
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`
      });

      // Get data for previous year
      const previousYearData = await analyticsApi.getProjectTrends('', {
        type: 'yearly',
        startDate: `${previousYear}-01-01`,
        endDate: `${previousYear}-12-31`
      });

      const current = {
        projects: currentYearData.summary?.totalProjects || 0,
        budget: currentYearData.summary?.totalBudget || 0,
        completed: currentYearData.summary?.completedProjects || 0
      };

      const previous = {
        projects: previousYearData.summary?.totalProjects || 0,
        budget: previousYearData.summary?.totalBudget || 0,
        completed: previousYearData.summary?.completedProjects || 0
      };

      return {
        currentYear: current,
        previousYear: previous,
        growth: {
          projects: this.calculateGrowthRate(current.projects, previous.projects),
          budget: this.calculateGrowthRate(current.budget, previous.budget),
          completed: this.calculateGrowthRate(current.completed, previous.completed)
        }
      };
    } catch (error) {
      log.error('Error fetching year-over-year comparison:', { data: error }, 'trend-analytics');
      return {
        currentYear: { projects: 0, budget: 0, completed: 0 },
        previousYear: { projects: 0, budget: 0, completed: 0 },
        growth: { projects: 0, budget: 0, completed: 0 }
      };
    }
  }

  /**
   * Get seasonal trends
   */
  static async getSeasonalTrends(): Promise<Array<{
    season: string;
    avgProjects: number;
    avgBudget: number;
    completionRate: number;
  }>> {
    try {
      // Get last 3 years of data
      const startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 3);
      
      const trendsData = await analyticsApi.getProjectTrends('', {
        type: 'monthly',
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString()
      });
      
      // Group by season and calculate averages
      const seasonalData: { [key: string]: { projects: number[], budgets: number[], completed: number[] } } = {
        'Winter': { projects: [], budgets: [], completed: [] },
        'Spring': { projects: [], budgets: [], completed: [] },
        'Summer': { projects: [], budgets: [], completed: [] },
        'Fall': { projects: [], budgets: [], completed: [] }
      };
      
      trendsData.trends?.forEach((month: any) => {
        const monthNum = new Date(month.month).getMonth() + 1;
        let season = '';
        
        if ([12, 1, 2].includes(monthNum)) season = 'Winter';
        else if ([3, 4, 5].includes(monthNum)) season = 'Spring';
        else if ([6, 7, 8].includes(monthNum)) season = 'Summer';
        else season = 'Fall';
        
        seasonalData[season]!.projects.push(month.totalProjects || 0);
        seasonalData[season]!.budgets.push(month.averageBudget || 0);
        seasonalData[season]!.completed.push(month.completedProjects || 0);
      });
      
      return Object.entries(seasonalData).map(([season, data]) => {
        const avgProjects = data.projects.reduce((a, b) => a + b, 0) / (data.projects.length || 1);
        const avgBudget = data.budgets.reduce((a, b) => a + b, 0) / (data.budgets.length || 1);
        const totalProjects = data.projects.reduce((a, b) => a + b, 0);
        const totalCompleted = data.completed.reduce((a, b) => a + b, 0);
        const completionRate = totalProjects > 0 ? (totalCompleted / totalProjects) * 100 : 0;
        
        return {
          season,
          avgProjects: Math.round(avgProjects),
          avgBudget: Math.round(avgBudget * 100) / 100,
          completionRate: Math.round(completionRate * 10) / 10
        };
      });
    } catch (error) {
      log.error('Error fetching seasonal trends:', { data: error }, 'trend-analytics');
      return [];
    }
  }

  /**
   * Calculate growth rate between two values
   */
  private static calculateGrowthRate(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100 * 10) / 10;
  }

  /**
   * Build WHERE clause for filtering
   */
  private static buildWhereClause(query: AnalyticsQuery): string {
    const conditions = ["status NOT IN ('archived', 'cancelled', 'deleted')"];

    if (query.startDate) {
      conditions.push(`created_at >= '${query.startDate.toISOString()}'`);
    }
    if (query.endDate) {
      conditions.push(`created_at <= '${query.endDate.toISOString()}'`);
    }
    if (query.clientId) {
      conditions.push(`client_id = '${query.clientId}'`);
    }
    if (query.status && query.status.length > 0) {
      const statusList = query.status.map(s => `'${s}'`).join(',');
      conditions.push(`status IN (${statusList})`);
    }
    if (query.includeInactive) {
      conditions[0] = 'TRUE'; // Remove status filter
    }

    return conditions.join(' AND ');
  }
}