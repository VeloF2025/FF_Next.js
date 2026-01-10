'use client';

/**
 * Analytics Dashboard Component - Refactored version
 * Main container using split components
 */

import React, { useState, lazy, useCallback } from 'react';
import { Calendar, Filter, Download, RefreshCw } from 'lucide-react';
import { DashboardHeader } from '../../components/dashboard/DashboardHeader';
import { StatsGrid } from '../../components/dashboard/EnhancedStatCard';
import { useAnalyticsData } from './hooks/useAnalyticsData';
import { useDashboardData } from '../../hooks/useDashboardData';
import { getAnalyticsDashboardCards } from '../../config/dashboards/dashboardConfigs';
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

  // 🟢 WORKING: Enhanced dashboard data for comprehensive metrics
  const { 
    stats: enhancedStats, 
    trends, 
    formatNumber: formatNum, 
    formatCurrency, 
    formatPercentage,
    loadDashboardData
  } = useDashboardData();

  // 🟢 WORKING: Get analytics dashboard cards
  const analyticsCards = getAnalyticsDashboardCards(
    {
      ...stats,
      polesInstalled: enhancedStats.polesInstalled,
      dropsCompleted: enhancedStats.dropsCompleted,
      fiberInstalled: enhancedStats.fiberInstalled,
      totalRevenue: enhancedStats.totalRevenue,
      teamMembers: enhancedStats.teamMembers,
    },
    trends,
    { formatNumber: formatNum, formatCurrency, formatPercentage }
  );

  // Memoize expensive operations
  const handleExport = useCallback(() => {
    // TODO: Implement analytics data export functionality
  }, []);

  const handleRefreshData = useCallback(() => {
    loadAnalyticsData();
    loadDashboardData();
  }, [loadAnalyticsData, loadDashboardData]);



  return (
    <div className="ff-page-container">
      <DashboardHeader 
        title="Analytics Dashboard"
        subtitle="Performance metrics and insights"
        actions={[
          {
            label: 'Export Report',
            icon: Download as React.ComponentType<{ className?: string; }>,
            onClick: handleExport,
            variant: 'secondary'
          },
          {
            label: 'Refresh Data',
            icon: RefreshCw as React.ComponentType<{ className?: string; }>,
            onClick: handleRefreshData,
            variant: 'primary'
          }
        ]}
      />

      {/* Filters Bar */}
      <div className="ff-card mb-6">
        <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
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
      </div>

      {/* Enhanced Stats Cards */}
      <StatsGrid 
        cards={analyticsCards}
        columns={5}
        className="mb-6"
      />

      {/* Original Stats Cards for comparison */}
      <div className="mb-6">
        <AnalyticsStatsCards stats={stats} formatNumber={formatNumber} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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