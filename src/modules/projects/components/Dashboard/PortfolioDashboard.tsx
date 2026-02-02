/**
 * Portfolio Dashboard (PRD-058)
 * Main dashboard component for project portfolio overview
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Wrench } from 'lucide-react';
import { PortfolioStatsCards } from './PortfolioStatsCards';
import { BudgetHealthCard } from './BudgetHealthCard';
import { NetworkProgressCard } from './NetworkProgressCard';
import { ExpiringDocsCard } from './ExpiringDocsCard';
import { RecentProjectsTable } from './RecentProjectsTable';
import type { PortfolioDashboardData } from './types';

/**
 * Fetch portfolio dashboard data
 */
async function fetchPortfolioDashboard(): Promise<PortfolioDashboardData> {
  const response = await fetch('/api/projects/portfolio-dashboard');
  if (!response.ok) {
    throw new Error('Failed to fetch portfolio dashboard data');
  }
  const data = await response.json();
  return data.data || data;
}

interface PortfolioDashboardProps {
  className?: string;
}

export function PortfolioDashboard({ className = '' }: PortfolioDashboardProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['portfolio-dashboard'],
    queryFn: fetchPortfolioDashboard,
    refetchInterval: 60000, // Refetch every minute
    staleTime: 30000, // Consider data stale after 30 seconds
  });

  // Default empty data for loading state
  const defaultData: PortfolioDashboardData = {
    counts: { total: 0, pipeline: 0, planned: 0, active: 0, completed: 0, onHold: 0, atRisk: 0 },
    budget: { totalBudget: 0, totalCommitted: 0, totalActual: 0, available: 0, utilizationPercent: 0, health: 'healthy' },
    network: { totalDrops: 0, completedDrops: 0, progressPercent: 0 },
    compliance: { avgHsScore: 0, openIncidents: 0, pendingAudits: 0 },
    maintenance: { openTickets: 0, criticalTickets: 0 },
    expiringDocs: { count30Days: 0, count60Days: 0, count90Days: 0 },
    recentProjects: [],
  };

  const dashboardData = data || defaultData;

  if (error) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="ff-card border-red-500/30">
          <div className="flex items-center gap-3 text-red-600">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-medium">Failed to load dashboard</p>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {error instanceof Error ? error.message : 'An error occurred'}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Check if we have meaningful data to show
  const hasMaintenanceData = dashboardData.maintenance.openTickets > 0 || dashboardData.maintenance.criticalTickets > 0;
  const hasComplianceData = dashboardData.compliance.openIncidents > 0 || dashboardData.compliance.pendingAudits > 0;
  const hasBudgetData = dashboardData.budget.totalBudget > 0;

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Stats Cards */}
      <PortfolioStatsCards
        counts={dashboardData.counts}
        expiringDocs={dashboardData.expiringDocs}
        isLoading={isLoading}
      />

      {/* Main Content - Network Progress + Recent Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <NetworkProgressCard network={dashboardData.network} isLoading={isLoading} />

          {/* Only show Budget if there's data */}
          {hasBudgetData && (
            <BudgetHealthCard budget={dashboardData.budget} isLoading={isLoading} />
          )}

          {/* Expiring Documents */}
          <ExpiringDocsCard expiringDocs={dashboardData.expiringDocs} isLoading={isLoading} />
        </div>

        <div className="lg:col-span-2">
          <RecentProjectsTable projects={dashboardData.recentProjects} isLoading={isLoading} />
        </div>
      </div>

      {/* Secondary Metrics - Only show if there's meaningful data */}
      {(hasMaintenanceData || hasComplianceData) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* H&S Compliance - only show if relevant */}
          {hasComplianceData && (
            <div className="ff-card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] tracking-wide">
                  Safety & Compliance
                </h3>
                <div className="p-2 rounded-lg bg-green-500/20">
                  <ShieldCheck className="w-5 h-5 text-green-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className={`text-2xl font-semibold ${dashboardData.compliance.openIncidents > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {dashboardData.compliance.openIncidents}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">Open Incidents</p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-amber-500">
                    {dashboardData.compliance.pendingAudits}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">Pending Audits</p>
                </div>
              </div>
            </div>
          )}

          {/* Maintenance - only show if there are tickets */}
          {hasMaintenanceData && (
            <div className="ff-card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] tracking-wide">
                  Maintenance Tickets
                </h3>
                <div className="p-2 rounded-lg bg-orange-500/20">
                  <Wrench className="w-5 h-5 text-orange-400" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-2xl font-semibold text-[var(--ff-text-primary)]">
                    {dashboardData.maintenance.openTickets}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">Open Tickets</p>
                </div>
                <div>
                  <p className={`text-2xl font-semibold ${dashboardData.maintenance.criticalTickets > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    {dashboardData.maintenance.criticalTickets}
                  </p>
                  <p className="text-xs text-[var(--ff-text-secondary)]">Critical</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PortfolioDashboard;
