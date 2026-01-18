/**
 * TrendReports - Trend analysis report section
 *
 * Reports:
 * - Daily/Weekly Trends Chart
 * - Completion Velocity
 * - Project Progress Tracker
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, BarChart3 } from 'lucide-react';
import type {
  ReportFilters,
  TrendAnalysisResponse,
  TrendGroupBy,
  ProjectProgress,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid, TrendChart } from './shared';

interface TrendReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

export function TrendReports({ filters, refreshKey }: TrendReportsProps) {
  const [groupBy, setGroupBy] = useState<TrendGroupBy>('day');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<TrendAnalysisResponse | null>(null);
  const [projectProgress, setProjectProgress] = useState<ProjectProgress[]>([]);

  // Fetch trend data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        params.set('groupBy', groupBy);
        if (filters.project) params.set('project', filters.project);

        const res = await fetch(`/api/activate/reporting/trends?${params}`);
        if (!res.ok) throw new Error('Failed to fetch trend data');

        const data = await res.json();
        setTrendData(data);

        // Also fetch project progress if available
        if (data.projects) {
          setProjectProgress(data.projects);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters, groupBy, refreshKey]);

  const TrendIcon = trendData?.velocity.installed_trend === 'up'
    ? TrendingUp
    : trendData?.velocity.installed_trend === 'down'
      ? TrendingDown
      : Minus;

  return (
    <div className="p-6 space-y-6">
      {/* Grouping Toggle */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          Group by:
        </span>
        <div className="flex gap-2">
          {(['day', 'week'] as TrendGroupBy[]).map((g) => (
            <button
              key={g}
              onClick={() => setGroupBy(g)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                groupBy === g
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {g === 'day' ? 'Daily' : 'Weekly'}
            </button>
          ))}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Velocity Summary Cards */}
      <ReportCardGrid columns={4}>
        <ReportCard
          title="Avg Installs"
          value={trendData?.velocity.avg_installed.toFixed(1) || '-'}
          subtitle={`per ${groupBy}`}
          color="blue"
          trend={trendData?.velocity.installed_trend}
          trendValue={
            trendData?.velocity.installed_wow_change
              ? `${trendData.velocity.installed_wow_change > 0 ? '+' : ''}${trendData.velocity.installed_wow_change.toFixed(0)}%`
              : undefined
          }
          isLoading={isLoading}
        />
        <ReportCard
          title="Avg Activations"
          value={trendData?.velocity.avg_activated.toFixed(1) || '-'}
          subtitle={`per ${groupBy}`}
          color="purple"
          trend={trendData?.velocity.activated_trend}
          trendValue={
            trendData?.velocity.activated_wow_change
              ? `${trendData.velocity.activated_wow_change > 0 ? '+' : ''}${trendData.velocity.activated_wow_change.toFixed(0)}%`
              : undefined
          }
          isLoading={isLoading}
        />
        <ReportCard
          title="Total Period"
          value={trendData?.data.reduce((sum, d) => sum + d.installed, 0) || 0}
          subtitle="Installed in period"
          color="green"
          isLoading={isLoading}
        />
        <ReportCard
          title="Data Points"
          value={trendData?.data.length || 0}
          subtitle={`${groupBy}s in range`}
          color="gray"
          icon={<BarChart3 className="h-4 w-4" />}
          isLoading={isLoading}
        />
      </ReportCardGrid>

      {/* Main Trend Chart */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <TrendChart
          title="Installation & Activation Trends"
          subtitle={`${filters.dateFrom} to ${filters.dateTo}`}
          data={trendData?.data.map((d) => ({
            date: d.label,
            Installed: d.installed,
            Activated: d.activated,
            Reviewed: d.reviewed,
            'Not Reviewed': d.notReviewed,
          })) || []}
          series={[
            { dataKey: 'Installed', name: 'Installed', color: '#3B82F6' },
            { dataKey: 'Activated', name: 'Activated', color: '#8B5CF6' },
            { dataKey: 'Reviewed', name: 'Reviewed', color: '#10B981' },
            { dataKey: 'Not Reviewed', name: 'Not Reviewed', color: '#F59E0B' },
          ]}
          type="line"
          xAxisKey="date"
          height={350}
          isLoading={isLoading}
          emptyMessage="No trend data available for the selected period"
        />
      </div>

      {/* Stacked Bar View */}
      <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4">
        <TrendChart
          title="Daily Volume Distribution"
          data={trendData?.data.map((d) => ({
            date: d.label,
            Reviewed: d.reviewed,
            'Not Reviewed': d.notReviewed,
          })) || []}
          series={[
            { dataKey: 'Reviewed', name: 'Reviewed', color: '#10B981', stackId: 'stack' },
            { dataKey: 'Not Reviewed', name: 'Not Reviewed', color: '#F59E0B', stackId: 'stack' },
          ]}
          type="bar"
          xAxisKey="date"
          height={250}
          isLoading={isLoading}
          emptyMessage="No data available"
        />
      </div>

      {/* Project Progress Table */}
      {projectProgress.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Project Progress Tracker
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Project
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Scope
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Installed
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Activated
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Est. Completion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {projectProgress.map((p) => (
                  <tr key={p.project}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                      {p.project}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {p.total_scope?.toLocaleString() || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-blue-600 dark:text-blue-400">
                      {p.installed.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-purple-600 dark:text-purple-400">
                      {p.activated.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {p.completion_percent !== null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full"
                              style={{ width: `${Math.min(100, p.completion_percent)}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                            {p.completion_percent.toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {p.estimated_completion || '-'}
                      {p.days_remaining !== null && p.days_remaining > 0 && (
                        <span className="text-xs text-gray-400 ml-1">
                          ({p.days_remaining}d)
                        </span>
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

export default TrendReports;
