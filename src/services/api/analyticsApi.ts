/**
 * Analytics API Service
 * Centralized API client for all analytics endpoints
 */

import { log } from '@/lib/logger';

// Types
export interface DashboardFilters {
  startDate?: string;
  endDate?: string;
  department?: string;
  status?: string[];
}

export interface TimePeriod {
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate?: string;
  endDate?: string;
}

export interface KPIParams {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  clientId?: string;
  departmentId?: string;
  includeInactive?: boolean;
}

export interface KPITarget {
  kpiId: string;
  kpiName: string;
  targetValue: number;
  minValue?: number;
  maxValue?: number;
  unit?: string;
  category?: string;
  period?: string;
}

export interface StaffFilters {
  department?: string;
  role?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface ReportParams {
  startDate?: string;
  endDate?: string;
  projectId?: string;
  clientId?: string;
  department?: string;
  format?: 'json' | 'pdf' | 'excel';
}

/**
 * Generic analytics response payload — the actual shape varies by endpoint.
 * Using a structured unknown map rather than `any` satisfies strict typing
 * while acknowledging the endpoint-specific variability.
 */
export type AnalyticsData = Record<string, unknown>;

// API client class
class AnalyticsApiClient {
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    try {
      const response = await fetch(`/api${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'API request failed');
      }

      return data.data || data;
    } catch (error) {
      log.error(`Analytics API error (${endpoint})`, { data: error }, 'analyticsApi');
      throw error;
    }
  }

  // Dashboard Analytics
  async getDashboardStats(filters?: DashboardFilters) {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    // Add timestamp to bypass cache
    params.append('t', Date.now().toString());

    return this.fetch<AnalyticsData>(`/analytics/dashboard/stats?${params}`);
  }

  async getDashboardSummary(period: TimePeriod) {
    const params = new URLSearchParams({ period: period.type });
    return this.fetch<AnalyticsData>(`/analytics/dashboard/summary?${params}`);
  }

  async getDashboardTrends(startDate: string, endDate: string, groupBy: string = 'month') {
    const params = new URLSearchParams({ startDate, endDate, groupBy });
    return this.fetch<AnalyticsData>(`/analytics/dashboard/trends?${params}`);
  }

  // Project Analytics
  async getProjectSummary(projectId?: string) {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    
    return this.fetch<AnalyticsData>(`/analytics/projects/summary?${params}`);
  }

  async getProjectPerformance(projectId: string, metrics: string[]) {
    const params = new URLSearchParams({
      projectId,
      metrics: metrics.join(',')
    });
    
    return this.fetch<AnalyticsData>(`/analytics/projects/performance?${params}`);
  }

  async getProjectTrends(projectId: string, period: TimePeriod) {
    const params = new URLSearchParams({
      projectId,
      period: period.type,
      ...(period.startDate && { startDate: period.startDate }),
      ...(period.endDate && { endDate: period.endDate })
    });
    
    return this.fetch<AnalyticsData>(`/analytics/projects/trends?${params}`);
  }

  async compareProjects(projectIds: string[], metrics: string[]) {
    return this.fetch<AnalyticsData>('/analytics/projects/comparison', {
      method: 'POST',
      body: JSON.stringify({ projectIds, metrics })
    });
  }

  // KPI Operations
  async getKPIs(category?: string) {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    
    return this.fetch<AnalyticsData[]>(`/analytics/kpis?${params}`);
  }

  async calculateKPIs(kpiIds: string[], parameters: KPIParams) {
    return this.fetch<AnalyticsData>('/analytics/kpis/calculate', {
      method: 'POST',
      body: JSON.stringify({ kpiIds, parameters })
    });
  }

  async getKPITargets() {
    return this.fetch<KPITarget[]>('/analytics/kpis/targets');
  }

  async setKPITargets(targets: KPITarget[]) {
    return this.fetch<KPITarget[]>('/analytics/kpis/targets', {
      method: 'POST',
      body: JSON.stringify({ targets })
    });
  }

  // Staff Analytics
  async getStaffStatistics(filters?: StaffFilters) {
    const params = new URLSearchParams();
    if (filters) params.append('filters', JSON.stringify(filters));
    
    return this.fetch<AnalyticsData>(`/analytics/staff/statistics?${params}`);
  }

  async getStaffPerformance(staffId?: string, period?: TimePeriod) {
    const params = new URLSearchParams();
    if (staffId) params.append('staffId', staffId);
    if (period) params.append('period', period.type);
    
    return this.fetch<AnalyticsData>(`/analytics/staff/performance?${params}`);
  }

  async getStaffTrends(department?: string, months: number = 12) {
    const params = new URLSearchParams({ months: months.toString() });
    if (department) params.append('department', department);
    
    return this.fetch<AnalyticsData>(`/analytics/staff/trends?${params}`);
  }

  async getTeamAnalytics(teamId?: string) {
    const params = new URLSearchParams();
    if (teamId) params.append('teamId', teamId);
    
    return this.fetch<AnalyticsData>(`/analytics/staff/teams?${params}`);
  }

  async getUtilizationRates(period: TimePeriod, department?: string) {
    const params = new URLSearchParams({ period: period.type });
    if (department) params.append('department', department);
    if (period.startDate) params.append('startDate', period.startDate);
    if (period.endDate) params.append('endDate', period.endDate);
    
    return this.fetch<AnalyticsData>(`/analytics/staff/utilization?${params}`);
  }

  // Financial Analytics
  async getFinancialSummary(period: TimePeriod, projectId?: string, clientId?: string) {
    const params = new URLSearchParams({ period: period.type });
    if (projectId) params.append('projectId', projectId);
    if (clientId) params.append('clientId', clientId);
    
    return this.fetch<AnalyticsData>(`/analytics/financial/summary?${params}`);
  }

  async getBudgetAnalysis(projectId?: string, clientId?: string, department?: string) {
    const params = new URLSearchParams();
    if (projectId) params.append('projectId', projectId);
    if (clientId) params.append('clientId', clientId);
    if (department) params.append('department', department);
    
    return this.fetch<AnalyticsData>(`/analytics/financial/budgets?${params}`);
  }

  // Reports
  async generateReport(reportType: string, parameters: ReportParams) {
    return this.fetch<AnalyticsData>('/analytics/reports/generate', {
      method: 'POST',
      body: JSON.stringify({ reportType, parameters })
    });
  }
}

// Export singleton instance
export const analyticsApi = new AnalyticsApiClient();