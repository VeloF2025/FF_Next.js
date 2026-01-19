/**
 * TicketingDashboard Component - Main Dashboard View
 *
 * 🟢 WORKING: Production-ready ticketing dashboard component
 *
 * Features:
 * - Summary statistics display
 * - SLA compliance metrics
 * - Workload distribution chart
 * - Recent tickets list
 * - Escalation alerts (when present)
 * - Auto-refresh capability
 * - Loading and error states
 * - Responsive grid layout
 */

'use client';

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SLAComplianceCard } from './SLAComplianceCard';
import { WorkloadChart } from './WorkloadChart';
import { RecentTickets } from './RecentTickets';
import type {
  DashboardSummary,
  WorkloadByAssignee,
  RecentTicket,
} from '../../services/dashboardService';

interface TicketingDashboardProps {
  /** Auto-refresh interval in milliseconds (default: 30000 = 30 seconds) */
  refreshInterval?: number;
  /** Compact mode for smaller displays */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Main ticketing dashboard component
 */
export function TicketingDashboard({
  refreshInterval = 30000,
  compact = false,
}: TicketingDashboardProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<DashboardSummary | null>(null);
  const [workloadData, setWorkloadData] = useState<WorkloadByAssignee[]>([]);
  const [recentTickets, setRecentTickets] = useState<RecentTicket[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // 🟢 WORKING: Fetch dashboard data
  const fetchDashboardData = React.useCallback(async () => {
    try {
      setIsLoading(true);
      setIsError(false);
      setError(null);

      // Fetch summary data
      const summaryResponse = await fetch('/api/ticketing/dashboard/summary');
      if (!summaryResponse.ok) {
        const errorData = await summaryResponse.json();
        throw new Error(errorData.error?.message || 'Failed to fetch dashboard data');
      }
      const summaryResult = await summaryResponse.json();
      if (!summaryResult.success) {
        throw new Error(summaryResult.error?.message || 'Failed to fetch dashboard data');
      }
      setSummaryData(summaryResult.data);

      // Fetch workload data
      const workloadResponse = await fetch('/api/ticketing/dashboard/workload?active_only=true');
      if (!workloadResponse.ok) {
        throw new Error('Failed to fetch workload data');
      }
      const workloadResult = await workloadResponse.json();
      if (workloadResult.success) {
        setWorkloadData(workloadResult.data);
      }

      // Fetch recent tickets (using tickets API with filters)
      const recentResponse = await fetch('/api/ticketing/tickets?limit=10&sort=created_at:desc');
      if (!recentResponse.ok) {
        throw new Error('Failed to fetch recent tickets');
      }
      const recentResult = await recentResponse.json();
      if (recentResult.success) {
        setRecentTickets(recentResult.data?.tickets || []);
      }

      setLastRefresh(new Date());
      setIsLoading(false);
    } catch (err) {
      setIsError(true);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setIsLoading(false);
    }
  }, []);

  // 🟢 WORKING: Initial fetch and auto-refresh
  React.useEffect(() => {
    fetchDashboardData();

    // Set up auto-refresh interval
    const intervalId = setInterval(fetchDashboardData, refreshInterval);

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchDashboardData, refreshInterval]);

  // 🟢 WORKING: Manual refresh handler
  const handleRefresh = () => {
    fetchDashboardData();
  };

  // 🟢 WORKING: Loading state
  if (isLoading && !summaryData) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[var(--ff-text-secondary)] animate-spin mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)]">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  // 🟢 WORKING: Error state
  if (isError && !summaryData) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-400 mb-1">Error Loading Dashboard</h3>
              <p className="text-sm text-red-300">{error || 'Failed to fetch dashboard data'}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Ticketing Dashboard</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Last updated {lastRefresh?.toLocaleTimeString() ?? 'Loading...'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Refresh dashboard"
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Escalation Alerts (if any) */}
      {summaryData && (summaryData as any).active_escalations > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-orange-400 mb-1">Active Escalations</h3>
              <p className="text-sm text-orange-300">
                {(summaryData as any).active_escalations} escalation(s) require attention
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary Statistics Grid */}
      {summaryData && (
        <div className={cn(
          'grid gap-4',
          compact ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        )}>
          {/* Total Tickets */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-blue-400" />
              <p className="text-sm text-[var(--ff-text-secondary)]">Total Tickets</p>
            </div>
            <p className="text-3xl font-bold text-[var(--ff-text-primary)]">{summaryData.total_tickets}</p>
          </div>

          {/* Open Tickets */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-4 h-4 text-yellow-400" />
              <p className="text-sm text-[var(--ff-text-secondary)]">Open</p>
            </div>
            <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
              {summaryData.by_status?.open || 0}
            </p>
          </div>

          {/* Overdue Tickets */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-red-400" />
              <p className="text-sm text-[var(--ff-text-secondary)]">Overdue</p>
            </div>
            <p className="text-3xl font-bold text-[var(--ff-text-primary)]">{summaryData.overdue_tickets}</p>
          </div>

          {/* Average Resolution */}
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-green-400" />
              <p className="text-sm text-[var(--ff-text-secondary)]">Avg. Resolution</p>
            </div>
            <p className="text-3xl font-bold text-[var(--ff-text-primary)]">
              {summaryData.avg_resolution_hours
                ? `${summaryData.avg_resolution_hours.toFixed(1)}h`
                : 'N/A'}
            </p>
          </div>
        </div>
      )}

      {/* Status Breakdown */}
      {summaryData && summaryData.by_status && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Tickets by Status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {Object.entries(summaryData.by_status).map(([status, count]) => (
              <div key={status} className="text-center">
                <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{count}</p>
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1 capitalize">
                  {status.replace(/_/g, ' ')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SLA Compliance and Workload */}
      <div className={cn(
        'grid gap-6',
        compact ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
      )}>
        {/* SLA Compliance Card */}
        {summaryData && summaryData.sla_compliance && (
          <SLAComplianceCard
            total={summaryData.sla_compliance.total}
            met={summaryData.sla_compliance.met}
            breached={summaryData.sla_compliance.breached}
            complianceRate={summaryData.sla_compliance.compliance_rate}
          />
        )}

        {/* Workload Chart */}
        <WorkloadChart data={workloadData} />
      </div>

      {/* Recent Tickets */}
      <RecentTickets tickets={recentTickets} limit={10} />
    </div>
  );
}
