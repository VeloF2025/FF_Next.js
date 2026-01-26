/**
 * Types for Portfolio Dashboard (PRD-058)
 */

export interface PortfolioCounts {
  total: number;
  pipeline: number;
  planned: number;
  active: number;
  completed: number;
  onHold: number;
  atRisk: number;
}

export interface BudgetMetrics {
  totalBudget: number;
  totalCommitted: number;
  totalActual: number;
  available: number;
  utilizationPercent: number;
  health: 'healthy' | 'warning' | 'critical';
}

export interface NetworkProgress {
  totalDrops: number;
  completedDrops: number;
  progressPercent: number;
}

export interface ComplianceMetrics {
  avgHsScore: number;
  openIncidents: number;
  pendingAudits: number;
}

export interface MaintenanceMetrics {
  openTickets: number;
  criticalTickets: number;
}

export interface ExpiringDocsMetrics {
  count30Days: number;
  count60Days: number;
  count90Days: number;
}

export interface RecentProject {
  id: string;
  project_name: string;
  client_name: string | null;
  status: string;
  progress: number;
  manager_name: string | null;
}

export interface PortfolioDashboardData {
  counts: PortfolioCounts;
  budget: BudgetMetrics;
  network: NetworkProgress;
  compliance: ComplianceMetrics;
  maintenance: MaintenanceMetrics;
  expiringDocs: ExpiringDocsMetrics;
  recentProjects: RecentProject[];
}

export interface StatCardConfig {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  href?: string;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
  };
}
