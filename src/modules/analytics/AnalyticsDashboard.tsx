'use client';

/**
 * Analytics Dashboard Component
 *
 * Following Maintenance Dashboard pattern:
 * - Inline header (not using DashboardHeader component)
 * - Styled refresh button
 * - Stat cards with small icon + label at top
 *
 * @see src/modules/noc/components/Dashboard/TicketingDashboard.tsx
 */

import React, { useState, lazy, useCallback } from 'react';
import { Calendar, Filter, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnalyticsData } from './hooks/useAnalyticsData';
import { useDashboardData } from '../../hooks/useDashboardData';
import { TimeRange } from './types/analytics.types';

// Lazy load heavy components
const AnalyticsStatsCards = lazy(() => import('./components').then(m => ({ default: m.AnalyticsStatsCards })));
const DailyProgressChart = lazy(() => import('./components').then(m => ({ default: m.DailyProgressChart })));
const ProjectStatusView = lazy(() => import('./components').then(m => ({ default: m.ProjectStatusView })));
const TeamPerformanceTable = lazy(() => import('./components').then(m => ({ default: m.TeamPerformanceTable })));
const KeyInsights = lazy(() => import('./components').then(m => ({ default: m.KeyInsights })));

const AnalyticsDashboard: React.FC = () => {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [selectedMetric, setSelectedMetric] = useState('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const {
    dailyProgress,
    projectMetrics,
    teamPerformance,
    isLoading,
    stats,
    formatNumber,
    getStatusColor,
    loadAnalyticsData
  } = useAnalyticsData(timeRange);

  // Dashboard data for refresh functionality
  const { loadDashboardData } = useDashboardData();

  // Handle refresh with loading state
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([loadAnalyticsData(), loadDashboardData()]);
      setLastRefresh(new Date());
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAnalyticsData, loadDashboardData]);

  return (
    <div className="space-y-6">
      {/* Header - Inline style matching Maintenance Dashboard */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Analytics Dashboard</h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {lastRefresh
              ? `Last updated ${lastRefresh.toLocaleTimeString()}`
              : 'Performance metrics and insights'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Refresh dashboard"
        >
          <RefreshCw className={cn('w-4 h-4', isRefreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stats Cards - Maintenance Dashboard pattern */}
      <AnalyticsStatsCards stats={stats} formatNumber={formatNumber} />

      {/* Filters Bar */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="px-3 py-1.5 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="24h">Last 24 Hours</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--ff-text-tertiary)]" />
            <select
              value={selectedMetric}
              onChange={(e) => setSelectedMetric(e.target.value)}
              className="px-3 py-1.5 border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">All Metrics</option>
              <option value="poles">Poles Only</option>
              <option value="drops">Drops Only</option>
              <option value="fiber">Fiber Only</option>
              <option value="revenue">Revenue Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <DailyProgressChart dailyProgress={dailyProgress} isLoading={isLoading} />
        <ProjectStatusView projectMetrics={projectMetrics} getStatusColor={getStatusColor} />
      </div>

      {/* Team Performance Table */}
      <TeamPerformanceTable teamPerformance={teamPerformance} />

      {/* Key Insights */}
      <KeyInsights />
    </div>
  );
};

export default AnalyticsDashboard;
