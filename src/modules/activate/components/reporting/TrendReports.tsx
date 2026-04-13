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
import { BarChart3, Target, Clock } from 'lucide-react';
import type {
  ReportFilters,
  TrendAnalysisResponse,
  TrendGroupBy,
  ProjectProgress,
} from '../../types/reporting.types';
import { ReportCard, ReportCardGrid, TrendChart } from './shared';
import { Button } from '@/components/ui/button';

interface TimeToActivationResponse {
  summary: {
    total_matched: number;
    avg_hours: number;
    median_hours: number;
    same_day_percent: number;
    within_24h_percent: number;
  };
  buckets: Array<{
    bucket: string;
    count: number;
    avg_hours: number;
  }>;
  daily_averages: Array<{
    date: string;
    count: number;
    avg_hours: number;
  }>;
}

interface TrendReportsProps {
  filters: ReportFilters;
  refreshKey: number;
}

// Series visibility state type
interface SeriesVisibility {
  installed: boolean;
  activated: boolean;
  reviewed: boolean;
  notReviewed: boolean;
}

// Generate a consistent color for a project name
const projectColors: Record<string, string> = {
  Lawley: '#3B82F6',     // blue
  Mohadin: '#8B5CF6',    // purple
  Mamelodi: '#10B981',   // green
  'Velo Test': '#D97706', // amber
};

const defaultProjectColors = [
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#C2410C', // orange
  '#84CC16', // lime
  '#14B8A6', // teal
  '#A855F7', // violet
];

function getProjectColor(project: string, index: number): string {
  const color = projectColors[project];
  if (color) return color;
  const fallback = defaultProjectColors[index % defaultProjectColors.length];
  return fallback ?? '#6B7280'; // gray fallback
}

export function TrendReports({ filters, refreshKey }: TrendReportsProps) {
  const [groupBy, setGroupBy] = useState<TrendGroupBy>('day');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<TrendAnalysisResponse | null>(null);
  const [projectProgress, setProjectProgress] = useState<ProjectProgress[]>([]);
  const [dailyTarget, setDailyTarget] = useState<number>(0);
  const [timeToActivation, setTimeToActivation] = useState<TimeToActivationResponse | null>(null);
  const [ttaLoading, setTtaLoading] = useState(true);

  // Series visibility toggles - all visible by default
  const [seriesVisibility, setSeriesVisibility] = useState<SeriesVisibility>({
    installed: true,
    activated: true,
    reviewed: true,
    notReviewed: true,
  });

  // Project visibility toggles - all visible by default
  const [projectVisibility, setProjectVisibility] = useState<Record<string, boolean>>({});

  // Toggle a series visibility
  const toggleSeries = (key: keyof SeriesVisibility) => {
    setSeriesVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Toggle a project visibility
  const toggleProject = (project: string) => {
    setProjectVisibility((prev) => ({ ...prev, [project]: !prev[project] }));
  };

  // Initialize project visibility when data loads
  // Filter out test projects and non-relevant projects from display
  const excludedProjectPatterns = ['test', 'velo test', 'test project', 'marketing activations'];
  const availableProjects = (trendData?.available_projects || []).filter(
    (proj) => !excludedProjectPatterns.some((pattern) => proj.toLowerCase().includes(pattern.toLowerCase()))
  );

  // Initialize all projects as visible when they first appear
  if (availableProjects.length > 0) {
    for (const proj of availableProjects) {
      if (projectVisibility[proj] === undefined) {
        projectVisibility[proj] = true;
      }
    }
  }

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

  // Fetch time-to-activation data
  useEffect(() => {
    const fetchTTA = async () => {
      setTtaLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        if (filters.project) params.set('project', filters.project);

        const res = await fetch(`/api/activate/reporting/time-to-activation?${params}`);
        if (!res.ok) throw new Error('Failed to fetch time-to-activation data');
        setTimeToActivation(await res.json());
      } catch (err) {
        // Silently fail - this is supplementary data
        setTimeToActivation(null);
      } finally {
        setTtaLoading(false);
      }
    };

    fetchTTA();
  }, [filters, refreshKey]);

  return (
    <div className="p-6 space-y-6">
      {/* Controls Row */}
      <div className="flex flex-wrap items-center gap-6">
        {/* Grouping Toggle */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">
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
                    : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {g === 'day' ? 'Daily' : 'Weekly'}
              </button>
            ))}
          </div>
        </div>

        {/* Daily Target Input */}
        <div className="flex items-center gap-3">
          <Target className="h-4 w-4 text-red-500" />
          <span className="text-sm font-medium text-muted-foreground">
            Daily Target:
          </span>
          <input
            type="number"
            value={dailyTarget || ''}
            onChange={(e) => setDailyTarget(parseInt(e.target.value) || 0)}
            placeholder="e.g. 50"
            className="w-24 px-3 py-1.5 border border-border rounded text-sm bg-card text-foreground focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {dailyTarget > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDailyTarget(0)}
              className="text-xs"
            >
              Clear
            </Button>
          )}
        </div>

        {/* Series Visibility Toggles */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">
            Series:
          </span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={seriesVisibility.installed}
              onChange={() => toggleSeries('installed')}
              className="w-4 h-4 rounded border-border text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">Installed</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={seriesVisibility.activated}
              onChange={() => toggleSeries('activated')}
              className="w-4 h-4 rounded border-border text-cyan-600 focus:ring-cyan-500"
            />
            <span className="text-sm text-cyan-600 dark:text-cyan-400 font-medium">Activated</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={seriesVisibility.reviewed}
              onChange={() => toggleSeries('reviewed')}
              className="w-4 h-4 rounded border-border text-green-600 focus:ring-green-500"
            />
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Reviewed</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={seriesVisibility.notReviewed}
              onChange={() => toggleSeries('notReviewed')}
              className="w-4 h-4 rounded border-border text-red-600 focus:ring-red-500"
            />
            <span className="text-sm text-red-600 dark:text-red-400 font-medium">Not Reviewed</span>
          </label>
        </div>
      </div>

      {/* Project Visibility Toggles - only show when multiple projects available */}
      {availableProjects.length > 1 && (
        <div className="flex flex-wrap items-center gap-4 px-6 -mt-4">
          <span className="text-sm font-medium text-muted-foreground">
            Projects:
          </span>
          {availableProjects.map((proj, idx) => (
            <label key={proj} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={projectVisibility[proj] !== false}
                onChange={() => toggleProject(proj)}
                className="w-4 h-4 rounded border-border focus:ring-2"
                style={{ accentColor: getProjectColor(proj, idx) }}
              />
              <span
                className="text-sm font-medium"
                style={{ color: getProjectColor(proj, idx) }}
              >
                {proj}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Velocity Summary Cards */}
      <ReportCardGrid columns={dailyTarget > 0 ? 5 : 4}>
        <ReportCard
          title="Avg Installs"
          value={trendData?.velocity?.avg_installed?.toFixed(1) || '-'}
          subtitle={`per ${groupBy}`}
          color="blue"
          trend={trendData?.velocity?.installed_trend}
          trendValue={
            trendData?.velocity?.installed_wow_change
              ? `${trendData.velocity.installed_wow_change > 0 ? '+' : ''}${trendData.velocity.installed_wow_change.toFixed(0)}%`
              : undefined
          }
          isLoading={isLoading}
        />
        <ReportCard
          title="Avg Activations"
          value={trendData?.velocity?.avg_activated?.toFixed(1) || '-'}
          subtitle={`per ${groupBy}`}
          color="purple"
          trend={trendData?.velocity?.activated_trend}
          trendValue={
            trendData?.velocity?.activated_wow_change
              ? `${trendData.velocity.activated_wow_change > 0 ? '+' : ''}${trendData.velocity.activated_wow_change.toFixed(0)}%`
              : undefined
          }
          isLoading={isLoading}
        />
        <ReportCard
          title="Total Period"
          value={trendData?.data?.reduce((sum, d) => sum + d.installed, 0) || 0}
          subtitle="Installed in period"
          color="green"
          isLoading={isLoading}
        />
        <ReportCard
          title="Data Points"
          value={trendData?.data?.length || 0}
          subtitle={`${groupBy}s in range`}
          color="gray"
          icon={<BarChart3 className="h-4 w-4" />}
          isLoading={isLoading}
        />
        {/* Target vs Actual Card - only shown when target is set */}
        {dailyTarget > 0 && (
          <ReportCard
            title="vs Target"
            value={
              trendData?.velocity?.avg_installed
                ? `${((trendData.velocity.avg_installed / dailyTarget) * 100).toFixed(0)}%`
                : '-'
            }
            subtitle={`of ${dailyTarget}/day target`}
            color={
              trendData?.velocity?.avg_installed && trendData.velocity.avg_installed >= dailyTarget
                ? 'green'
                : trendData?.velocity?.avg_installed && trendData.velocity.avg_installed >= dailyTarget * 0.8
                  ? 'yellow'
                  : 'red'
            }
            icon={<Target className="h-4 w-4" />}
            isLoading={isLoading}
          />
        )}
      </ReportCardGrid>

      {/* Main Trend Chart */}
      <div className="bg-background/50 rounded-lg p-4">
        <TrendChart
          title="Installation & Activation Trends"
          subtitle={`${filters.dateFrom} to ${filters.dateTo}${dailyTarget > 0 ? ` • Target: ${dailyTarget}/day` : ''}`}
          data={trendData?.data?.map((d) => {
            // If we have per-project data and some projects are toggled off, compute filtered totals
            if (d.by_project && availableProjects.length > 1) {
              let installed = 0, activated = 0, reviewed = 0, notReviewed = 0;
              for (const proj of availableProjects) {
                if (projectVisibility[proj] !== false && d.by_project[proj]) {
                  installed += d.by_project[proj].installed;
                  activated += d.by_project[proj].activated;
                  reviewed += d.by_project[proj].reviewed;
                  notReviewed += d.by_project[proj].notReviewed;
                }
              }
              return {
                date: d.label,
                Installed: installed,
                Activated: activated,
                Reviewed: reviewed,
                'Not Reviewed': notReviewed,
              };
            }
            // No project breakdown, use totals
            return {
              date: d.label,
              Installed: d.installed,
              Activated: d.activated,
              Reviewed: d.reviewed,
              'Not Reviewed': d.notReviewed,
            };
          }) || []}
          series={[
            ...(seriesVisibility.installed ? [{ dataKey: 'Installed', name: 'Installed', color: '#3B82F6' }] : []),
            ...(seriesVisibility.activated ? [{ dataKey: 'Activated', name: 'Activated', color: '#06B6D4' }] : []),
            ...(seriesVisibility.reviewed ? [{ dataKey: 'Reviewed', name: 'Reviewed', color: '#10B981' }] : []),
            ...(seriesVisibility.notReviewed ? [{ dataKey: 'Not Reviewed', name: 'Not Reviewed', color: '#EF4444' }] : []),
          ]}
          type="line"
          xAxisKey="date"
          height={350}
          isLoading={isLoading}
          emptyMessage="No trend data available for the selected period"
          targetValue={dailyTarget > 0 ? dailyTarget : undefined}
          targetLabel="Daily Target"
        />
      </div>

      {/* Per-Project Bar View */}
      <div className="bg-background/50 rounded-lg p-4">
        <TrendChart
          title="Daily Volume Distribution by Project"
          subtitle={`Showing: ${seriesVisibility.installed ? 'Installed' : seriesVisibility.activated ? 'Activated' : seriesVisibility.reviewed ? 'Reviewed' : 'Not Reviewed'}`}
          data={trendData?.data?.map((d) => {
            // Build data point with each project as a separate key
            const dataPoint: Record<string, unknown> = { date: d.label };

            if (d.by_project && availableProjects.length > 1) {
              // Multiple projects - show each project separately
              for (const proj of availableProjects) {
                if (projectVisibility[proj] !== false && d.by_project[proj]) {
                  const projData = d.by_project[proj];
                  // Use the first visible series metric
                  if (seriesVisibility.installed) {
                    dataPoint[proj] = projData.installed;
                  } else if (seriesVisibility.activated) {
                    dataPoint[proj] = projData.activated;
                  } else if (seriesVisibility.reviewed) {
                    dataPoint[proj] = projData.reviewed;
                  } else if (seriesVisibility.notReviewed) {
                    dataPoint[proj] = projData.notReviewed;
                  }
                }
              }
            } else {
              // Single project or no breakdown - show as "Total"
              if (seriesVisibility.installed) {
                dataPoint['Total'] = d.installed;
              } else if (seriesVisibility.activated) {
                dataPoint['Total'] = d.activated;
              } else if (seriesVisibility.reviewed) {
                dataPoint['Total'] = d.reviewed;
              } else if (seriesVisibility.notReviewed) {
                dataPoint['Total'] = d.notReviewed;
              }
            }

            return dataPoint;
          }) || []}
          series={
            availableProjects.length > 1
              ? availableProjects
                  .filter((proj) => projectVisibility[proj] !== false)
                  .map((proj, idx) => ({
                    dataKey: proj,
                    name: proj,
                    color: getProjectColor(proj, idx),
                  }))
              : [{ dataKey: 'Total', name: 'Total', color: '#3B82F6' }]
          }
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
          <h3 className="text-lg font-semibold text-foreground">
            Project Progress Tracker
          </h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-background/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Project
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Scope
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Installed
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Activated
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Progress
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                    Est. Completion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {projectProgress.map((p) => (
                  <tr key={p.project}>
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {p.project}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
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
                          <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                            <div
                              className="h-full bg-green-500 rounded-full"
                              style={{ width: `${Math.min(100, p.completion_percent)}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">
                            {p.completion_percent.toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
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

      {/* Time-to-Activation Section */}
      <div className="space-y-4 border-t border-border pt-6">
        <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Clock className="h-5 w-5 text-purple-500" />
          Time-to-Activation Metrics
        </h3>

        {ttaLoading ? (
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse bg-secondary rounded-lg" />
            ))}
          </div>
        ) : timeToActivation ? (
          <>
            {/* Summary Cards */}
            <ReportCardGrid columns={4}>
              <ReportCard
                title="Avg Time"
                value={formatDuration(timeToActivation.summary?.avg_hours ?? 0)}
                subtitle="WA → OES"
                color="purple"
                icon={<Clock className="h-4 w-4" />}
              />
              <ReportCard
                title="Median Time"
                value={formatDuration(timeToActivation.summary?.median_hours ?? 0)}
                subtitle="50th percentile"
                color="blue"
              />
              <ReportCard
                title="Same Day"
                value={`${(timeToActivation.summary?.same_day_percent ?? 0).toFixed(0)}%`}
                subtitle={`${timeToActivation.summary?.total_matched ?? 0} total`}
                color="green"
              />
              <ReportCard
                title="Within 24h"
                value={`${(timeToActivation.summary?.within_24h_percent ?? 0).toFixed(0)}%`}
                subtitle="Including same day"
                color="cyan"
              />
            </ReportCardGrid>

            {/* Time Distribution */}
            <div className="bg-background/50 rounded-lg p-4">
              <TrendChart
                title="Time-to-Activation Distribution"
                subtitle="How long from WA submission to OES activation"
                data={timeToActivation.buckets.map((b) => ({
                  bucket: b.bucket,
                  Count: b.count,
                }))}
                series={[{ dataKey: 'Count', name: 'Activations', color: '#8B5CF6' }]}
                type="bar"
                xAxisKey="bucket"
                height={200}
                emptyMessage="No activation data available"
              />
            </div>

            {/* Daily Average Trend */}
            {timeToActivation.daily_averages.length > 1 && (
              <div className="bg-background/50 rounded-lg p-4">
                <TrendChart
                  title="Daily Average Time-to-Activation"
                  subtitle="Trend over selected period (lower is better)"
                  data={timeToActivation.daily_averages.map((d) => ({
                    date: d.date,
                    'Avg Hours': d.avg_hours,
                    Count: d.count,
                  }))}
                  series={[
                    { dataKey: 'Avg Hours', name: 'Avg Hours', color: '#8B5CF6' },
                  ]}
                  type="line"
                  xAxisKey="date"
                  height={200}
                  emptyMessage="Not enough data for trend"
                />
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No time-to-activation data available for the selected period
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours.toFixed(0)}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = Math.round(hours % 24);
  if (remainingHours === 0) return `${days}d`;
  return `${days}d ${remainingHours}h`;
}

export default TrendReports;
