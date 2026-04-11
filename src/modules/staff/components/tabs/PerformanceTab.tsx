/**
 * Performance Tab Component
 *
 * Displays field technician performance metrics for a staff member.
 * Links staff phone number to DR submissions for metrics.
 *
 * Features:
 * - Summary stats (submissions, first pass rate, serial compliance)
 * - Daily activity trend chart
 * - Project breakdown
 * - Recent submissions list
 * - Team comparison percentiles
 *
 * @author Jarvis
 * @date 2026-02-01
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  TrendingUp,
  Target,
  CheckCircle,
  XCircle,
  RefreshCw,
  Calendar,
  Award,
  Users,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { TrendChart, GaugeChart } from '@/components/ui/charts';
import { formatDisplayDate } from '@/utils/dateFormat';
import { log } from '@/lib/logger';

interface StaffPerformanceMetrics {
  staffId: string;
  staffName: string;
  phone: string | null;
  whatsappId: string | null;
  dateRange: {
    from: string;
    to: string;
  };
  summary: {
    totalSubmissions: number;
    firstPassSuccess: number;
    firstPassRate: number;
    resubmissions: number;
    resubmissionRate: number;
    ontScanned: number;
    upsScanned: number;
    serialComplianceRate: number;
    projectsWorked: string[];
    activeDays: number;
  };
  trend: {
    date: string;
    submissions: number;
    firstPass: number;
    resubmissions: number;
  }[];
  projectBreakdown: {
    project: string;
    submissions: number;
    firstPassRate: number;
    serialComplianceRate: number;
  }[];
  recentSubmissions: {
    dropNumber: string;
    project: string;
    submittedAt: string;
    submissionCount: number;
    qaDecision: string | null;
    feedbackSent: boolean;
  }[];
  comparisonToTeam: {
    metric: string;
    staffValue: number;
    teamAverage: number;
    percentile: number;
  }[];
}

type TimeRange = '7d' | '30d' | '90d';

interface PerformanceTabProps {
  staffId: string;
}

export function PerformanceTab({ staffId }: PerformanceTabProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [data, setData] = useState<StaffPerformanceMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getDateRange = useCallback(() => {
    const today = new Date();
    const to = today.toISOString().split('T')[0];
    let from: string;

    switch (timeRange) {
      case '7d':
        from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '30d':
        from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      case '90d':
        from = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        break;
      default:
        from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    }

    return { from, to };
  }, [timeRange]);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { from, to } = getDateRange();
      const response = await fetch(
        `/api/staff/${staffId}/performance?dateFrom=${from}&dateTo=${to}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch performance data');
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      log.error('PerformanceTab', 'Failed to fetch performance data', { error: err });
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, [staffId, getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="ff-card p-4 animate-pulse">
              <div className="h-4 bg-[var(--ff-bg-tertiary)] rounded w-24 mb-2" />
              <div className="h-8 bg-[var(--ff-bg-tertiary)] rounded w-16" />
            </div>
          ))}
        </div>
        <div className="ff-card p-6 animate-pulse">
          <div className="h-64 bg-[var(--ff-bg-tertiary)] rounded" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ff-card p-6 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
          Failed to Load Performance Data
        </h3>
        <p className="text-[var(--ff-text-secondary)] mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.summary.totalSubmissions === 0) {
    return (
      <div className="ff-card p-6 text-center">
        <BarChart3 className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">
          No Field Performance Data
        </h3>
        <p className="text-[var(--ff-text-secondary)]">
          {data?.phone
            ? 'No DR submissions found for this staff member in the selected time range.'
            : 'This staff member does not have a phone number linked for DR tracking.'}
        </p>
      </div>
    );
  }

  const trendChartData = data.trend.map((t) => ({
    date: t.date,
    Submissions: t.submissions,
    'First Pass': t.firstPass,
    Resubmissions: t.resubmissions,
  }));

  return (
    <div className="space-y-6">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            Field Performance
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)]">
            {data.summary.activeDays} active days • {data.summary.projectsWorked.length} projects
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-[var(--ff-bg-secondary)] rounded-lg p-1">
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
                {range === '7d' ? '7D' : range === '30d' ? '30D' : '90D'}
              </button>
            ))}
          </div>

          <button
            onClick={fetchData}
            className="p-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Total Submissions</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {data.summary.totalSubmissions}
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            {data.dateRange.from} to {data.dateRange.to}
          </div>
        </div>

        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">First Pass Rate</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {data.summary.firstPassRate}%
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            {data.summary.firstPassSuccess} / {data.summary.totalSubmissions} submissions
          </div>
        </div>

        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-purple-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Serial Compliance</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {data.summary.serialComplianceRate}%
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            ONT: {data.summary.ontScanned} • UPS: {data.summary.upsScanned}
          </div>
        </div>

        <div className="ff-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <XCircle className="w-4 h-4 text-orange-500" />
            <span className="text-sm text-[var(--ff-text-secondary)]">Resubmission Rate</span>
          </div>
          <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
            {data.summary.resubmissionRate}%
          </div>
          <div className="text-xs text-[var(--ff-text-tertiary)]">
            {data.summary.resubmissions} resubmissions
          </div>
        </div>
      </div>

      {/* Team Comparison + Performance Gauges */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Team Comparison */}
        <div className="ff-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Team Comparison
            </h3>
          </div>
          <div className="space-y-4">
            {data.comparisonToTeam.map((comp) => (
              <div key={comp.metric}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--ff-text-secondary)]">{comp.metric}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                      {comp.staffValue}%
                    </span>
                    <span className="text-xs text-[var(--ff-text-tertiary)]">
                      (Team avg: {comp.teamAverage}%)
                    </span>
                  </div>
                </div>
                <div className="relative h-2 bg-[var(--ff-bg-tertiary)] rounded-full">
                  <div
                    className={`h-2 rounded-full ${
                      comp.staffValue >= comp.teamAverage ? 'bg-green-500' : 'bg-orange-500'
                    }`}
                    style={{ width: `${Math.min(100, comp.staffValue)}%` }}
                  />
                  {/* Team average marker */}
                  <div
                    className="absolute top-0 w-0.5 h-4 -mt-1 bg-gray-400"
                    style={{ left: `${Math.min(100, comp.teamAverage)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span
                    className={`text-xs font-medium ${
                      comp.percentile >= 50 ? 'text-green-500' : 'text-orange-500'
                    }`}
                  >
                    {comp.percentile >= 75
                      ? '🏆 Top 25%'
                      : comp.percentile >= 50
                        ? '✓ Above Average'
                        : '⚠️ Below Average'}
                  </span>
                  <span className="text-xs text-[var(--ff-text-tertiary)]">
                    {comp.percentile}th percentile
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Performance Gauges */}
        <div className="ff-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Award className="w-5 h-5 text-yellow-500" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Performance Score
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col items-center">
              <GaugeChart
                value={data.summary.firstPassRate}
                target={85}
                label="First Pass"
                color="auto"
                size="md"
              />
            </div>
            <div className="flex flex-col items-center">
              <GaugeChart
                value={data.summary.serialComplianceRate}
                target={95}
                label="Serial Compliance"
                color="auto"
                size="md"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Activity Trend */}
      {data.trend.length > 0 && (
        <div className="ff-card p-6">
          <TrendChart
            title="Daily Activity"
            subtitle={`${timeRange === '7d' ? 'Last 7 days' : timeRange === '30d' ? 'Last 30 days' : 'Last 90 days'}`}
            data={trendChartData}
            series={[
              { dataKey: 'Submissions', name: 'Submissions', color: '#3B82F6' },
              { dataKey: 'First Pass', name: 'First Pass', color: '#10B981' },
              { dataKey: 'Resubmissions', name: 'Resubmissions', color: '#D97706' },
            ]}
            type="bar"
            xAxisKey="date"
            height={250}
          />
        </div>
      )}

      {/* Project Breakdown */}
      {data.projectBreakdown.length > 0 && (
        <div className="ff-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-purple-500" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Project Breakdown
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="text-left py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Project
                  </th>
                  <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Submissions
                  </th>
                  <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    First Pass
                  </th>
                  <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Serial Compliance
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.projectBreakdown.map((p) => (
                  <tr
                    key={p.project}
                    className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"
                  >
                    <td className="py-3 text-[var(--ff-text-primary)] font-medium">{p.project}</td>
                    <td className="py-3 text-center text-[var(--ff-text-primary)]">
                      {p.submissions}
                    </td>
                    <td className="py-3 text-center">
                      <span
                        className={`font-medium ${
                          p.firstPassRate >= 85
                            ? 'text-green-500'
                            : p.firstPassRate >= 70
                              ? 'text-yellow-500'
                              : 'text-red-500'
                        }`}
                      >
                        {p.firstPassRate}%
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      <span
                        className={`font-medium ${
                          p.serialComplianceRate >= 95
                            ? 'text-green-500'
                            : p.serialComplianceRate >= 80
                              ? 'text-yellow-500'
                              : 'text-red-500'
                        }`}
                      >
                        {p.serialComplianceRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Submissions */}
      {data.recentSubmissions.length > 0 && (
        <div className="ff-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">
              Recent Submissions
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)]">
                  <th className="text-left py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    DR Number
                  </th>
                  <th className="text-left py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Project
                  </th>
                  <th className="text-left py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Submitted
                  </th>
                  <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Attempts
                  </th>
                  <th className="text-center py-2 text-sm font-medium text-[var(--ff-text-secondary)]">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recentSubmissions.slice(0, 10).map((sub) => (
                  <tr
                    key={sub.dropNumber}
                    className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-hover)]"
                  >
                    <td className="py-3">
                      <a
                        href={`/activate?dr=${sub.dropNumber}`}
                        className="text-blue-500 hover:text-blue-600 font-medium"
                      >
                        {sub.dropNumber}
                      </a>
                    </td>
                    <td className="py-3 text-[var(--ff-text-secondary)]">{sub.project}</td>
                    <td className="py-3 text-[var(--ff-text-secondary)]">
                      {formatDisplayDate(sub.submittedAt)}
                    </td>
                    <td className="py-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          sub.submissionCount === 1
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                        }`}
                      >
                        {sub.submissionCount}
                      </span>
                    </td>
                    <td className="py-3 text-center">
                      {sub.qaDecision ? (
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-medium ${
                            sub.qaDecision.toLowerCase() === 'pass'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : sub.qaDecision.toLowerCase() === 'fail'
                                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          }`}
                        >
                          {sub.qaDecision}
                        </span>
                      ) : sub.feedbackSent ? (
                        <span className="text-xs text-[var(--ff-text-tertiary)]">Reviewed</span>
                      ) : (
                        <span className="text-xs text-[var(--ff-text-tertiary)]">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default PerformanceTab;
