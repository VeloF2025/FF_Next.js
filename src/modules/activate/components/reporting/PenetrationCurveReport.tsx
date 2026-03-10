/**
 * PenetrationCurveReport - Activation penetration % over time with drill-down
 *
 * Purpose: Line chart showing penetration % (0-100) over time
 * - Multi-series: Project → Zone → PON
 * - Interactive drill-down via legend clicks
 * - Breadcrumb navigation for context
 * - Daily/Weekly granularity toggle
 * - Summary badges showing final penetration % per series
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect } from 'react';
import {
  ChevronLeft,
  TrendingUp,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  TooltipProps,
} from 'recharts';
import type { ReportFilters, PenetrationCurveResponse, PenetrationGroupBy } from '../../types/reporting.types';

const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f97316','#6366f1'];

interface PenetrationCurveReportProps {
  filters: ReportFilters;
  refreshKey: number;
}

interface ChartPoint {
  date: string;
  [key: string]: unknown;
}

interface CustomTooltipPayload {
  name: string;
  value: number;
  color: string;
}

export function PenetrationCurveReport({ filters, refreshKey }: PenetrationCurveReportProps) {
  // State
  const [data, setData] = useState<PenetrationCurveResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState<PenetrationGroupBy>('project');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [granularity, setGranularity] = useState<'daily' | 'weekly'>('daily');

  // Fetch data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set('dateFrom', filters.dateFrom);
        params.set('dateTo', filters.dateTo);
        params.set('groupBy', groupBy);
        params.set('granularity', granularity);

        if (groupBy !== 'project' && selectedProject) {
          params.set('project', selectedProject);
        }

        if (groupBy === 'pon' && selectedZone !== null) {
          params.set('zone', selectedZone.toString());
        }

        const res = await fetch(`/api/activate/reporting/penetration-curve?${params}`);
        if (!res.ok) {
          throw new Error(`Failed to fetch: ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters, refreshKey, groupBy, selectedProject, selectedZone, granularity]);

  // Drill-down handler
  const handleDrillDown = (series: { key: string; label: string }) => {
    if (groupBy === 'project') {
      setGroupBy('zone');
      setSelectedProject(series.key);
    } else if (groupBy === 'zone') {
      const zoneNo = parseInt(series.key.replace('zone-', ''), 10);
      setGroupBy('pon');
      setSelectedZone(zoneNo);
    }
  };

  // Breadcrumb navigation
  const getBreadcrumb = () => {
    if (groupBy === 'project') {
      return ['All Projects'];
    } else if (groupBy === 'zone') {
      return [
        { label: 'All Projects', onClick: () => { setGroupBy('project'); setSelectedProject(null); } },
        `Project ${selectedProject ? selectedProject.substring(0, 8) : '?'}`,
      ];
    } else {
      const zoneLabel = selectedZone !== null ? `Zone ${selectedZone}` : '?';
      return [
        { label: 'All Projects', onClick: () => { setGroupBy('project'); setSelectedProject(null); setSelectedZone(null); } },
        { label: `Project ${selectedProject ? selectedProject.substring(0, 8) : '?'}`, onClick: () => { setGroupBy('zone'); setSelectedZone(null); } },
        zoneLabel,
      ];
    }
  };

  // Transform data for chart
  const getChartData = (): ChartPoint[] => {
    if (!data || data.series.length === 0) {
      return [];
    }

    const points: ChartPoint[] = [];
    for (const date of data.dates) {
      const point: ChartPoint = { date };

      for (const series of data.series) {
        const seriesPoint = series.points.find((p) => p.date === date);
        if (seriesPoint) {
          point[series.key] = seriesPoint.penetration_pct;
        }
      }

      points.push(point);
    }

    return points;
  };

  const chartData = getChartData();

  // Custom tooltip
  const CustomTooltip = (props: TooltipProps<number, string> & { payload?: CustomTooltipPayload[]; label?: string }) => {
    const { active, payload, label } = props;
    if (!active || !payload || !data) return null;

    return (
      <div className="bg-card border border-border rounded p-3 shadow-lg">
        <p className="font-semibold text-sm">{label}</p>
        {payload.map((entry, idx) => {
          const series = data.series.find((s) => s.key === entry.name);
          const value = entry.value as number;
          return (
            <p key={idx} style={{ color: entry.color }} className="text-sm">
              {series?.label}: {value.toFixed(1)}%
            </p>
          );
        })}
      </div>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto mb-2 text-blue-600" />
          <p className="text-muted-foreground">Loading penetration curve...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-lg">
        <div className="flex gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-900 dark:text-red-100">Error</h3>
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data || data.series.length === 0) {
    return (
      <div className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900/30">
        <div className="flex gap-3">
          <TrendingUp className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-700 dark:text-gray-300">No Data</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">No activations found for the selected period and filters.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {getBreadcrumb().map((item, idx) => (
          <div key={idx} className="flex items-center gap-2">
            {typeof item === 'string' ? (
              <span className="font-medium text-foreground">{item}</span>
            ) : (
              <button
                onClick={item.onClick}
                className="text-blue-600 hover:underline flex items-center gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                {item.label}
              </button>
            )}
            {idx < getBreadcrumb().length - 1 && <span>/</span>}
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          <button
            onClick={() => setGranularity('daily')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              granularity === 'daily'
                ? 'bg-blue-600 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Daily
          </button>
          <button
            onClick={() => setGranularity('weekly')}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              granularity === 'weekly'
                ? 'bg-blue-600 text-white'
                : 'bg-secondary text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Weekly
          </button>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-lg p-4 h-96">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              stroke="var(--muted-foreground)"
              tickFormatter={(date: string) => {
                const d = new Date(date);
                return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short' });
              }}
            />
            <YAxis
              stroke="var(--muted-foreground)"
              domain={[0, 100]}
              tickFormatter={(val: number) => `${val}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              onClick={(e) => {
                const series = data.series.find((s) => s.key === e.dataKey);
                if (series && groupBy !== 'pon') {
                  handleDrillDown(series);
                }
              }}
              wrapperStyle={{ cursor: groupBy !== 'pon' ? 'pointer' : 'default' }}
            />
            {data.series.map((series, idx) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={COLORS[idx % COLORS.length]}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary badges */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {data.series.map((series, idx) => {
          const lastPoint = series.points[series.points.length - 1];
          const penetration = lastPoint?.penetration_pct ?? 0;
          return (
            <div
              key={series.key}
              className="p-3 rounded-lg border border-border bg-card"
              style={{ borderLeftColor: COLORS[idx % COLORS.length], borderLeftWidth: '4px' }}
            >
              <p className="text-xs text-muted-foreground truncate">{series.label}</p>
              <p className="text-lg font-bold">{penetration.toFixed(1)}%</p>
              <p className="text-xs text-muted-foreground mt-1">{lastPoint?.cumulative ?? 0} / {series.total_scope}</p>
            </div>
          );
        })}
      </div>

      {/* Message for PON level */}
      {groupBy === 'pon' && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs text-blue-900 dark:text-blue-100">
          PON level — deepest drill available
        </div>
      )}
    </div>
  );
}

export default PenetrationCurveReport;
