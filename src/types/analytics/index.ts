/**
 * Unified Analytics Type Definitions
 * Consolidates all analytics types to prevent mismatches
 */

// Date range filter
export interface DateRange {
  from: Date;
  to: Date;
}

// Project Overview Types - Unified
export interface ProjectOverview {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  delayedProjects: number;
  totalValue: number;
  averageCompletionRate: number;
  // Additional properties from services
  totalBudget: number;
  spentBudget: number;
  avgCompletion: number;
}

// KPI Dashboard Types - Unified
export interface KPIMetric {
  id: string;
  name: string;
  value: number | string;
  change: number;
  changeType: 'increase' | 'decrease' | 'neutral';
  unit?: string;
  target?: number;
  trend?: number[];
}

export interface KPIDashboardItem {
  metricType: string;
  metricName: string;
  currentValue: number;
  unit: string;
  recordCount: number;
}

// Financial Overview Types - Unified
export interface FinancialMetrics {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  cashFlow: number;
  budgetUtilization: number;
  // Additional properties from services
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  pendingAmount: number;
  overdueCount: number;
  monthlyTrends?: {
    month: string;
    revenue: number;
    expenses: number;
    profit: number;
  }[];
}

// Legacy alias for backward compatibility
export interface FinancialOverview extends FinancialMetrics {}

// Client Types
export interface TopClient {
  clientId: string;
  clientName: string;
  totalProjects: number;
  totalRevenue: number;
  paymentScore: number;
  avgProjectSize?: number;
  lastProjectDate?: Date | string;
  // Additional from services
  lifetimeValue: number;
}

export interface ClientAnalyticsData extends TopClient {
  lifetimeValue: number;
}

// Project Trend Types - Unified
export interface ProjectTrend {
  period: string;
  date: Date | string;
  newProjects: number;
  completedProjects: number;
  activeProjects: number;
  totalValue: number;
  // Additional properties from services
  month: string;
  avgCompletion: number;
  totalBudget: number;
}

// KPI Trends
export interface KPITrend {
  date: string;
  value: number;
  count: number;
}

// Cash Flow
export interface CashFlowTrend {
  month: string;
  income: number;
  expenses: number;
  netFlow: number;
}

// Staff Performance
export interface StaffPerformanceSummary {
  staffName: string;
  role: string;
  avgProductivity: number;
  avgQuality: number;
  totalHours: number;
  totalTasks: number;
  attendanceRate: number;
}

// Dashboard Data Structure
export interface DashboardData {
  projectOverview: ProjectOverview;
  kpiDashboard: KPIMetric[];
  financialOverview: FinancialMetrics;
  topClients: TopClient[];
  projectTrends: ProjectTrend[];
}

// Executive Summary
export interface ExecutiveSummary {
  projects: ProjectOverview[];
  financial: FinancialOverview[];
  kpis: KPIDashboardItem[];
  topClients: ClientAnalyticsData[];
  generatedAt: Date;
  period: DateRange;
}

// Component Props
export interface AnalyticsDashboardProps {
  className?: string;
}

export interface DashboardHeaderProps {
  lastSyncTime?: Date | null;
  onSync: () => void;
  syncing: boolean;
}

export interface KeyMetricsProps {
  data: DashboardData;
}

export interface DashboardChartsProps {
  projectTrends: ProjectTrend[];
  kpiDashboard: KPIMetric[];
}

export interface FinancialOverviewProps {
  financialOverview: FinancialMetrics;
}

export interface TopClientsProps {
  topClients: TopClient[];
}

export interface SystemStatusProps {
  lastSyncTime?: Date | null;
}

// Audit Types
export interface AuditMetadata {
  ip?: string;
  userAgent?: string;
  sessionId?: string;
}

export interface AuditChanges {
  old?: Record<string, unknown>;
  new?: Record<string, unknown>;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  source: string;
  timestamp: Date;
}

// Transform functions for type compatibility
export function transformKPIDashboardItemsToMetrics(items: KPIDashboardItem[]): KPIMetric[] {
  return items.map(item => ({
    id: `${item.metricType}_${item.metricName}`,
    name: item.metricName,
    value: item.currentValue,
    change: 0, // Default value - would need historical data to calculate
    changeType: 'neutral' as const,
    unit: item.unit
  }));
}