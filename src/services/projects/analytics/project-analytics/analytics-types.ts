/**
 * Analytics Types
 * Type definitions for project analytics and reporting
 */

export interface ProjectSummary {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  onHoldProjects: number;
  averageProgress: number;
}

export interface ProjectStatusStats {
  status: string;
  count: number;
}

export interface ClientProjectStats {
  clientId: string;
  clientName: string;
  projectCount: number;
  totalBudget: number;
}

export interface MonthlyTrend {
  month: string;
  completed: number;
  started: number;
}

export interface BudgetAnalysis {
  totalBudget: number;
  averageBudget: number;
  budgetByStatus: Array<{ status: string; totalBudget: number }>;
}

export interface OverdueProject {
  id: string;
  name: string;
  endDate: Date;
  daysOverdue: number;
  clientName: string;
}

export interface ProjectPerformanceMetrics {
  onTimeCompletionRate: number;
  averageProjectDuration: number;
  budgetUtilizationRate: number;
  clientSatisfactionScore: number;
}

export interface TimelineData {
  date: string;
  projectsStarting: number;
  projectsEnding: number;
  milestones: number;
}

export interface AnalyticsQuery {
  startDate?: Date;
  endDate?: Date;
  clientId?: string;
  projectId?: string;
  department?: string;
  status?: string[];
  includeInactive?: boolean;
}

export interface PerformanceKPI {
  name: string;
  value: number;
  target: number;
  trend: 'up' | 'down' | 'stable';
  unit: string;
  description: string;
}