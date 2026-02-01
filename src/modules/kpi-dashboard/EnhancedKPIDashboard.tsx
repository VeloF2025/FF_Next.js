'use client';

/**
 * Enhanced KPI Dashboard
 *
 * Real-time performance metrics with interactive charts.
 * Uses existing reporting infrastructure from activate/services/reportingService.
 *
 * Features:
 * - Installation trend chart (7/30/90 days)
 * - Team/Technician leaderboard with QA pass rates
 * - QA Funnel visualization
 * - Project comparison view
 *
 * @author Jarvis
 * @date 2026-02-01
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Users,
  TrendingUp,
  Target,
  RefreshCw,
  Calendar,
  Award,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { useKPIDashboardData } from '@/hooks/useDashboardData';
import { TrendChart, FunnelChart, GaugeChart } from '@/modules/activate/components/reporting/shared/TrendChart';
import { log } from '@/lib/logger';

// Types for API responses
interface TrendDataPoint {
  label: string;
  date: string;
  installed: number;
  activated: number;
  reviewed: number;
  notReviewed: number;
}

interface TrendAnalysisResponse {
  date_range: { from: string; to: string };
  group_by: string;
  project: string | null;
  available_projects: string[];
  data: TrendDataPoint[];
  velocity: {
    avg_installed: number;
    avg_activated: number;
    installed_trend: 'up' | 'down' | 'stable';
    activated_trend: 'up' | 'down' | 'stable';
    installed_wow_change: number;
    activated_wow_change: number;
  };
}

interface TechnicianLeaderboardEntry {
  rank: number;
  user_name: string;
  sender_phone: string;
  projects: string[];
  total_submissions: number;
  first_pass_success: number;
  first_pass_rate: number;
  resubmissions: number;
  resubmission_rate: number;
  ont_scanned: number;
  ups_scanned: number;
  serial_compliance: number;
}

interface TeamPerformanceResponse {
  date_range: { from: string; to: string };
  leaderboard: TechnicianLeaderboardEntry[];
  summary: {
    total_technicians: number;
    avg_first_pass_rate: number;
    avg_serial_compliance: number;
  };
}

interface QAFunnelResponse {
  funnel: Array<{
    stage: string;
    count: number;
    percentage: number;
  }>;
  summary: {
    total_submitted: number;
    conversion_rate: number;
    photo_completion_rate: number;
  };
}

// Time range options
type TimeRange = '7d' | '30d' | '90d';

export function EnhancedKPIDashboard() {
  // State
  const [timeRange, setTimeRange] = useState<TimeRange>('7d');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Data states
  const [trendData, setTrendData] = useState<TrendAnalysisResponse | null>(null);
  const [teamData, setTeamData] = useState<TeamPerformanceResponse | null>(null);
  const [funnelData, setFunnelData] = useState<QAFunnelResponse | null>(null);
  const [availableProjects, setAvailableProjects] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Use existing dashboard data hook for refresh
  const {
    loadDashboardData,
  } = useKPIDashboardData();

  // Calculate date range based on selection
  const getDateRange = useCallback(() => {
    const today = new Date();
    const to = today.toISOString().split('T')[0];
    let from: string;

    switch (timeRange) {
      case '7d':
        from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        break;
      case '30d':
        from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        break;
      case '90d':
        from = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
        break;
      default:
        from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];
    }

    return { from, to };
  }, [timeRange]);

  // Fetch trend data
  const fetchTrendData = useCallback(async () => {
    try {
      const { from, to } = getDateRange();
      const projectParam = selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '';
      const groupBy = timeRange === '90d' ? 'week' : 'day';
      
      const response = await fetch(
        `/api/activate/reporting/trends?dateFrom=${from}&dateTo=${to}&groupBy=${groupBy}${projectParam}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch trend data');
      
      const data: TrendAnalysisResponse = await response.json();
      setTrendData(data);
      
      if (data.available_projects?.length > 0) {
        setAvailableProjects(data.available_projects);
      }
    } catch (err) {
      log.error('EnhancedKPIDashboard', 'Failed to fetch trend data', { error: err });
      setError('Failed to load trend data');
    }
  }, [getDateRange, selectedProject, timeRange]);

  // Fetch team performance data
  const fetchTeamData = useCallback(async () => {
    try {
      const { from, to } = getDateRange();
      const projectParam = selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '';
      
      const response = await fetch(
        `/api/activate/reporting/team-performance?dateFrom=${from}&dateTo=${to}${projectParam}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch team data');
      
      const data = await response.json();
      setTeamData(data);
    } catch (err) {
      log.error('EnhancedKPIDashboard', 'Failed to fetch team data', { error: err });
    }
  }, [getDateRange, selectedProject]);

  // Fetch QA funnel data
  const fetchFunnelData = useCallback(async () => {
    try {
      const { from, to } = getDateRange();
      const projectParam = selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '';
      
      const response = await fetch(
        `/api/activate/reporting/funnel?dateFrom=${from}&dateTo=${to}${projectParam}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch funnel data');
      
      const data: QAFunnelResponse = await response.json();
      setFunnelData(data);
    } catch (err) {
      log.error('EnhancedKPIDashboard', 'Failed to fetch funnel data', { error: err });
    }
  }, [getDateRange, selectedProject]);

  // Combined refresh function
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    
    try {
      await Promise.all([
        loadDashboardData(),
        fetchTrendData(),
        fetchTeamData(),
        fetchFunnelData(),
      ]);
      setLastRefresh(new Date());
    } catch (err) {
      log.error('EnhancedKPIDashboard', 'Refresh failed', { error: err });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadDashboardData, fetchTrendData, fetchTeamData, fetchFunnelData]);

  // Initial load and refresh on time range change
  useEffect(() => {
    handleRefresh();
  }, [timeRange, selectedProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prepare trend chart data
  const trendChartData = trendData?.data?.map((d) => ({
    label: d.label,
    Installed: d.installed,
    Activated: d.activated,
    Reviewed: d.reviewed,
    'Not Reviewed': d.notReviewed,
  })) || [];

  // Prepare funnel data
  const funnelStages = funnelData?.funnel?.map((f, idx) => ({
    name: f.stage,
    value: f.count,
    percentage: f.percentage,
    color: ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B'][idx % 4],
  })) || [];

  return (
    <div className="ff-page-container space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
            KPI Dashboard
          </h1>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            {lastRefresh
              ? `Last updated ${lastRefresh.toLocaleTimeString()}`
              : 'Real-time performance metrics'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Time Range Selector */}
          <div className="flex items-center gap-2 bg-[var(--ff-bg-secondary)] rounded-lg p-1">
            {(['7d', '30d', '90d'] as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  timeRange === range
                    ? 'bg-blue-500 text-white'
                    : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
                }`}
              >
                {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>

          {/* Project Filter */}
          {availableProjects.length > 0 && (
            <select
              value={selectedProject || ''}
              onChange={(e) => setSelectedProject(e.target.value || null)}
              className="px-3 py-2 text-sm border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] rounded-lg"
            >
              <option value="">All Projects</option>
              {availableProjects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <span className="text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Velocity Metrics - Primary KPIs */}
      {trendData?.velocity && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="ff-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Avg Daily Installs
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {trendData.velocity.avg_installed.toFixed(1)}
            </div>
            <div
              className={`text-sm flex items-center gap-1 ${
                trendData.velocity.installed_trend === 'up'
                  ? 'text-green-500'
                  : trendData.velocity.installed_trend === 'down'
                    ? 'text-red-500'
                    : 'text-gray-500'
              }`}
            >
              {trendData.velocity.installed_trend === 'up' ? '↑' : trendData.velocity.installed_trend === 'down' ? '↓' : '→'}
              {Math.abs(trendData.velocity.installed_wow_change)}% vs prev period
            </div>
          </div>

          <div className="ff-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-[var(--ff-text-secondary)]">
                Avg Daily Activations
              </span>
            </div>
            <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {trendData.velocity.avg_activated.toFixed(1)}
            </div>
            <div
              className={`text-sm flex items-center gap-1 ${
                trendData.velocity.activated_trend === 'up'
                  ? 'text-green-500'
                  : trendData.velocity.activated_trend === 'down'
                    ? 'text-red-500'
                    : 'text-gray-500'
              }`}
            >
              {trendData.velocity.activated_trend === 'up' ? '↑' : trendData.velocity.activated_trend === 'down' ? '↓' : '→'}
              {Math.abs(trendData.velocity.activated_wow_change)}% vs prev period
            </div>
          </div>

          {funnelData?.summary && (
            <>
              <div className="ff-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4 text-purple-500" />
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    QA Conversion Rate
                  </span>
                </div>
                <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {funnelData.summary.conversion_rate}%
                </div>
                <div className="text-sm text-[var(--ff-text-tertiary)]">
                  Submitted → Feedback Sent
                </div>
              </div>

              <div className="ff-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-[var(--ff-text-secondary)]">
                    Photo Completion
                  </span>
                </div>
                <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                  {funnelData.summary.photo_completion_rate}%
                </div>
                <div className="text-sm text-[var(--ff-text-tertiary)]">
                  All 10 steps captured
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Performance Trend Chart */}
        <div className="ff-card p-6">
          <TrendChart
            title="Installation Trend"
            subtitle={`${timeRange === '7d' ? 'Last 7 days' : timeRange === '30d' ? 'Last 30 days' : 'Last 90 days'} • ${selectedProject || 'All Projects'}`}
            data={trendChartData}
            series={[
              { dataKey: 'Installed', name: 'Installed', color: '#3B82F6' },
              { dataKey: 'Activated', name: 'Activated', color: '#10B981' },
              { dataKey: 'Reviewed', name: 'Reviewed', color: '#8B5CF6' },
            ]}
            type="line"
            xAxisKey="label"
            height={300}
            isLoading={isRefreshing && !trendData}
            emptyMessage="No trend data available"
          />
        </div>

        {/* QA Funnel */}
        <div className="ff-card p-6">
          <FunnelChart
            title="QA Workflow Funnel"
            stages={funnelStages}
            height={300}
            isLoading={isRefreshing && !funnelData}
          />
        </div>
      </div>

      {/* Technician Leaderboard */}
      {teamData?.leaderboard && teamData.leaderboard.length > 0 && (
        <div className="ff-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-yellow-500" />
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Technician Leaderboard
              </h3>
            </div>
            <span className="text-sm text-[var(--ff-text-secondary)]">
              {teamData.leaderboard.length} technicians
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Rank
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Technician
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Submissions
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                    First Pass Rate
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Serial Compliance
                  </th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Resubmissions
                  </th>
                </tr>
              </thead>
              <tbody>
                {teamData.leaderboard.slice(0, 10).map((tech) => (
                  <tr
                    key={tech.rank}
                    className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {tech.rank <= 3 ? (
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                              tech.rank === 1
                                ? 'bg-yellow-500'
                                : tech.rank === 2
                                  ? 'bg-gray-400'
                                  : 'bg-amber-600'
                            }`}
                          >
                            {tech.rank}
                          </span>
                        ) : (
                          <span className="w-6 h-6 flex items-center justify-center text-sm text-[var(--ff-text-secondary)]">
                            {tech.rank}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-medium text-[var(--ff-text-primary)]">
                          {tech.user_name || 'Unknown'}
                        </div>
                        <div className="text-xs text-[var(--ff-text-tertiary)]">
                          {tech.projects?.join(', ') || 'No project'}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-[var(--ff-text-primary)]">
                      {tech.total_submissions}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-[var(--ff-bg-tertiary)] rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              tech.first_pass_rate >= 90
                                ? 'bg-green-500'
                                : tech.first_pass_rate >= 70
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(100, tech.first_pass_rate)}%` }}
                          />
                        </div>
                        <span className="text-sm text-[var(--ff-text-primary)]">
                          {tech.first_pass_rate}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-sm font-medium ${
                          tech.serial_compliance >= 95
                            ? 'text-green-500'
                            : tech.serial_compliance >= 80
                              ? 'text-yellow-500'
                              : 'text-red-500'
                        }`}
                      >
                        {tech.serial_compliance}%
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-sm ${
                          tech.resubmission_rate <= 10
                            ? 'text-green-500'
                            : tech.resubmission_rate <= 25
                              ? 'text-yellow-500'
                              : 'text-red-500'
                        }`}
                      >
                        {tech.resubmissions} ({tech.resubmission_rate}%)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {teamData.leaderboard.length > 10 && (
            <div className="mt-4 text-center">
              <button className="text-sm text-blue-500 hover:text-blue-600">
                View all {teamData.leaderboard.length} technicians →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Performance Gauges */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <div className="ff-card p-6 flex flex-col items-center">
          <GaugeChart
            value={teamData?.summary?.avg_first_pass_rate || 0}
            target={85}
            label="Avg First Pass Rate"
            color="auto"
            size="md"
          />
        </div>
        <div className="ff-card p-6 flex flex-col items-center">
          <GaugeChart
            value={teamData?.summary?.avg_serial_compliance || 0}
            target={95}
            label="Serial Compliance"
            color="auto"
            size="md"
          />
        </div>
        <div className="ff-card p-6 flex flex-col items-center">
          <GaugeChart
            value={funnelData?.summary?.conversion_rate || 0}
            target={80}
            label="QA Conversion"
            color="auto"
            size="md"
          />
        </div>
        <div className="ff-card p-6 flex flex-col items-center">
          <GaugeChart
            value={funnelData?.summary?.photo_completion_rate || 0}
            target={90}
            label="Photo Completion"
            color="auto"
            size="md"
          />
        </div>
      </div>
    </div>
  );
}

export default EnhancedKPIDashboard;
