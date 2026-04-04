/**
 * PenetrationCurveReport - Activation penetration % over time with drill-down
 *
 * Purpose: Line chart showing penetration % (0-100) on Y-axis,
 *          ELAPSED TIME (days/weeks since first activation) on X-axis.
 *          All series start at Day 0 regardless of calendar start date,
 *          making rate-of-penetration directly comparable across projects.
 *
 * - Multi-series: Project → Zone → PON
 * - Interactive drill-down via legend or badge clicks
 * - Breadcrumb navigation showing project/zone names (not UUIDs)
 * - X-axis = elapsed days or weeks since each series' first activation
 * - Daily/Weekly granularity toggle
 * - Summary badges showing final penetration % per series
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ChevronRight,
  TrendingUp,
  AlertCircle,
  Loader2,
  MousePointerClick,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import type {
  ReportFilters,
  PenetrationCurveResponse,
  PenetrationGroupBy,
  PenetrationSeries,
} from '../../types/reporting.types';

// Series palette — hex values are intentional for Recharts SVG stroke compatibility.
// Annotated with matching --ff-* design tokens where applicable:
//   #3b82f6 = --ff-primary-500 / --ff-info
//   #10b981 = --ff-success
//   #f59e0b = --ff-warning
//   #ef4444 = --ff-error
//   #8b5cf6 = --ff-status-planning
//   Remaining 5 have no --ff-* equivalent (intentionally distinct hues).
const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

interface PenetrationCurveReportProps {
  filters: ReportFilters;
  refreshKey: number;
}

interface ChartPoint {
  elapsed: number; // days or weeks since first activation for this series
  [key: string]: unknown;
}

// Track drill-down context with both key (UUID) and display label
interface DrillContext {
  projectKey: string | null;
  projectLabel: string | null;
  zoneKey: number | null;
  zoneLabel: string | null;
}

export function PenetrationCurveReport({ filters, refreshKey }: PenetrationCurveReportProps) {
  const [data, setData] = useState<PenetrationCurveResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [groupBy, setGroupBy] = useState<PenetrationGroupBy>('project');
  const [drill, setDrill] = useState<DrillContext>({
    projectKey: null, projectLabel: null,
    zoneKey: null, zoneLabel: null,
  });
  const [granularity, setGranularity] = useState<'daily' | 'weekly'>('daily');
  const [hideZero, setHideZero] = useState(true);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const [scopeMode, setScopeMode] = useState<'full' | 'live_pons'>('full');

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
        params.set('scopeMode', scopeMode);

        if (groupBy !== 'project' && drill.projectKey) {
          params.set('project', drill.projectKey);
        }
        if (groupBy === 'pon' && drill.zoneKey !== null) {
          params.set('zone', drill.zoneKey.toString());
        }

        const res = await fetch(`/api/activate/reporting/penetration-curve?${params}`);
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [filters, refreshKey, groupBy, drill, granularity, scopeMode]);

  // Drill-down handler — preserves labels for breadcrumb
  const handleDrillDown = (series: PenetrationSeries) => {
    if (groupBy === 'project') {
      setGroupBy('zone');
      setDrill(d => ({ ...d, projectKey: series.key, projectLabel: series.label }));
    } else if (groupBy === 'zone') {
      const zoneNo = parseInt(series.key.replace('zone-', ''), 10);
      setGroupBy('pon');
      setDrill(d => ({ ...d, zoneKey: zoneNo, zoneLabel: series.label }));
    }
  };

  const backToProjects = () => {
    setGroupBy('project');
    setDrill({ projectKey: null, projectLabel: null, zoneKey: null, zoneLabel: null });
  };

  const backToZones = () => {
    setGroupBy('zone');
    setDrill(d => ({ ...d, zoneKey: null, zoneLabel: null }));
  };

  // Transform API date-based data into elapsed-time-based chart data.
  // Each series independently starts at elapsed=0 (its own first activation date).
  // Weekly mode groups into week buckets (elapsed = weeks since first activation).
  const { chartData, maxElapsed, maxPenetration } = useMemo(() => {
    if (!data || data.series.length === 0) return { chartData: [], maxElapsed: 0, maxPenetration: 100 };

    // Build per-series elapsed→penetration maps
    const seriesElapsedMaps = new Map<string, Map<number, number>>();
    let globalMax = 0;
    let globalMaxPct = 0;

    const visibleSeries = data.series.filter(s => {
      if (hiddenSeries.has(s.key)) return false;
      if (hideZero && (s.points.length === 0 || (s.points[s.points.length - 1]?.penetration_pct ?? 0) === 0)) return false;
      return true;
    });

    for (const series of visibleSeries) {
      if (series.points.length === 0) continue;

      const firstDate = new Date(((series.points[0]?.date ?? '') as string) + 'T00:00:00');
      const elapsedMap = new Map<number, number>();

      for (const point of series.points) {
        const pointDate = new Date((point.date as string) + 'T00:00:00');
        const daysElapsed = Math.round(
          (pointDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        const elapsed = granularity === 'weekly' ? Math.floor(daysElapsed / 7) : daysElapsed;

        // For weekly buckets, keep the highest penetration (last point in the week)
        const existing = elapsedMap.get(elapsed) ?? -1;
        if (point.penetration_pct > existing) {
          elapsedMap.set(elapsed, point.penetration_pct);
        }
        if (point.penetration_pct > globalMaxPct) globalMaxPct = point.penetration_pct;
        if (elapsed > globalMax) globalMax = elapsed;
      }

      seriesElapsedMaps.set(series.key, elapsedMap);
    }

    // Collect all unique elapsed values across all series
    const allElapsed = new Set<number>();
    for (const elapsedMap of seriesElapsedMaps.values()) {
      for (const elapsed of elapsedMap.keys()) {
        allElapsed.add(elapsed);
      }
    }

    const sortedElapsed = Array.from(allElapsed).sort((a, b) => a - b);

    const chartPoints: ChartPoint[] = sortedElapsed.map(elapsed => {
      const point: ChartPoint = { elapsed };
      for (const series of visibleSeries) {
        const val = seriesElapsedMaps.get(series.key)?.get(elapsed);
        if (val !== undefined) point[series.key] = val;
        // undefined = no data at this elapsed value → gap in line (connectNulls=false)
      }
      return point;
    });

    // Auto-scale Y ceiling: round up to nearest 10%, min 20%, max 100%
    const yCeiling = Math.min(100, Math.max(20, Math.ceil((globalMaxPct + 5) / 10) * 10));
    return { chartData: chartPoints, maxElapsed: globalMax, maxPenetration: yCeiling };
  }, [data, granularity, hideZero, hiddenSeries]);

  // Smart X-axis ticks for elapsed time
  const xAxisTicks = useMemo(() => {
    if (maxElapsed === 0) return [0];

    const step = granularity === 'weekly'
      ? (maxElapsed <= 12 ? 1 : maxElapsed <= 26 ? 2 : 4) // weekly: every 1/2/4 weeks
      : (maxElapsed <= 60 ? 10 : maxElapsed <= 180 ? 30 : 60); // daily: every 10/30/60 days

    const ticks: number[] = [];
    for (let i = 0; i <= maxElapsed; i += step) {
      ticks.push(i);
    }
    return ticks;
  }, [maxElapsed, granularity]);

  // X-axis label formatter
  const formatXTick = (val: number) => {
    if (granularity === 'weekly') return `Wk ${val}`;
    return `D${val}`;
  };

  // Stable color map: assign colors based on original data.series index (never shifts when filtering)
  const colorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (data) {
      data.series.forEach((s, idx) => map.set(s.key, COLORS[idx % COLORS.length]!));
    }
    return map;
  }, [data]);

  // Custom tooltip — shows elapsed label + series values ranked desc
  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean;
    payload?: Array<{ name: string; value: number; color: string }>;
    label?: number;
  }) => {
    if (!active || !payload || payload.length === 0) return null;

    const elapsedLabel = granularity === 'weekly'
      ? `Week ${label ?? 0}`
      : `Day ${label ?? 0}`;

    const sorted = [...payload]
      .filter(e => typeof e.value === 'number')
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-xl min-w-[180px]" role="tooltip">
        <p className="font-semibold text-xs text-muted-foreground mb-2" id="tooltip-label">{elapsedLabel}</p>
        {sorted.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} aria-hidden="true" />
              <span className="text-xs text-muted-foreground truncate max-w-[120px]">{entry.name}</span>
            </div>
            <span className="text-xs font-bold tabular-nums" style={{ color: entry.color }}>
              {entry.value.toFixed(1)}%
            </span>
          </div>
        ))}
        {sorted.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border text-xs text-muted-foreground text-center" aria-live="polite">
            {groupBy !== 'pon' ? '↓ Click badge below to drill down' : 'PON level (deepest)'}
          </div>
        )}
      </div>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <div className="text-center space-y-3">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">Loading penetration curve...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6">
        <div className="flex gap-3 p-4 border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 rounded-lg">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm text-red-900 dark:text-red-100">Failed to load data</p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data || data.series.length === 0 || chartData.length === 0) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <TrendingUp className="h-12 w-12 text-muted-foreground/40 mb-4" aria-hidden="true" />
          <p className="font-semibold text-muted-foreground">No activation data found</p>
          <p className="text-sm text-muted-foreground/70 mt-1">No activations recorded up to {filters.dateTo}</p>
        </div>
      </div>
    );
  }

  const canDrillDown = groupBy !== 'pon';
  const scopeLabel = scopeMode === 'live_pons' ? ' (Live PONs)' : '';
  const chartTitle = groupBy === 'project'
    ? 'All Projects'
    : groupBy === 'zone'
    ? `${drill.projectLabel ?? 'Project'} — Zones`
    : `${drill.projectLabel ?? 'Project'} › ${drill.zoneLabel ?? 'Zone'} — PONs`;

  const xAxisLabel = granularity === 'weekly' ? 'Weeks since first activation' : 'Days since first activation';

  return (
    <div className="p-6 space-y-5">

      {/* Header row: breadcrumb + controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm flex-wrap">
          {groupBy === 'project' ? (
            <span className="font-semibold text-foreground">All Projects</span>
          ) : (
            <Button variant="link" onClick={backToProjects} aria-label="Back to all projects">
              All Projects
            </Button>
          )}
          {(groupBy === 'zone' || groupBy === 'pon') && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {groupBy === 'zone' ? (
                <span className="font-semibold text-foreground">{drill.projectLabel ?? 'Project'}</span>
              ) : (
                <Button variant="link" onClick={backToZones} aria-label={`Back to ${drill.projectLabel ?? 'Project'} zones`}>
                  {drill.projectLabel ?? 'Project'}
                </Button>
              )}
            </>
          )}
          {groupBy === 'pon' && (
            <>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-semibold text-foreground">{drill.zoneLabel ?? 'Zone'}</span>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          {canDrillDown && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground/80 italic">
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden="true" />
              Click legend to toggle · Click badge to drill down
            </span>
          )}
          {groupBy === 'pon' && (
            <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              PON level — deepest
            </span>
          )}
          <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Scope mode">
            <button
              onClick={() => setScopeMode('full')}
              aria-pressed={scopeMode === 'full'}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scopeMode === 'full'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
              title="Denominator = full project scope (PO contracted drops)"
            >
              Full Project
            </button>
            <button
              onClick={() => setScopeMode('live_pons')}
              aria-pressed={scopeMode === 'live_pons'}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scopeMode === 'live_pons'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
              title="Denominator = only drops in PONs with at least one activation"
            >
              Live PONs
            </button>
          </div>
          <button
            onClick={() => setHideZero(h => !h)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border border-border transition-colors ${
              hideZero
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700'
                : 'bg-card text-muted-foreground hover:bg-accent'
            }`}
            aria-label={`${hideZero ? 'Show all series' : 'Hide series with 0% penetration'}`}
            title="Hide series with 0% penetration"
          >
            {hideZero ? 'Showing active only' : 'Show all'}
          </button>
          <div className="flex rounded-lg border border-border overflow-hidden" role="group" aria-label="Chart granularity">
            <button
              onClick={() => setGranularity('daily')}
              aria-pressed={granularity === 'daily'}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                granularity === 'daily'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              Daily
            </button>
            <button
              onClick={() => setGranularity('weekly')}
              aria-pressed={granularity === 'weekly'}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                granularity === 'weekly'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-accent'
              }`}
            >
              Weekly
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-xl p-4" style={{ height: 480 }}>
        <p className="text-xs font-medium text-muted-foreground mb-1 ml-1">
          {chartTitle} — Penetration %{scopeLabel} · {xAxisLabel}
        </p>
        <ResponsiveContainer width="100%" height="92%">
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-gray-700)" opacity={0.5} />
            <XAxis
              dataKey="elapsed"
              type="number"
              domain={[0, maxElapsed]}
              ticks={xAxisTicks}
              tickFormatter={formatXTick}
              stroke="var(--ff-gray-400)"
              tick={{ fontSize: 11, fill: 'var(--ff-gray-400)' }}
              tickLine={false}
              label={{
                value: xAxisLabel,
                position: 'insideBottom',
                offset: -12,
                style: { fontSize: 11, fill: 'var(--ff-gray-400)' },
              }}
            />
            <YAxis
              domain={[0, maxPenetration]}
              tickFormatter={(v: number) => `${v}%`}
              stroke="var(--ff-gray-400)"
              tick={{ fontSize: 11, fill: 'var(--ff-gray-400)' }}
              tickLine={false}
              width={40}
            />
            {maxPenetration === 100 && (
              <ReferenceLine y={100} stroke="var(--ff-gray-500)" strokeDasharray="4 2" strokeOpacity={0.3} />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              iconSize={8}
              wrapperStyle={{
                paddingBottom: '8px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
              formatter={(value: string) => value}
              onClick={(e) => {
                const key = e.dataKey as string;
                if (!key) return;
                setHiddenSeries(prev => {
                  const next = new Set(prev);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
            />
            {data.series.map((series) => (
              <Line
                key={series.key}
                type="monotone"
                dataKey={series.key}
                name={series.label}
                stroke={colorMap.get(series.key) ?? 'var(--ff-gray-500)'}
                dot={false}
                strokeWidth={2}
                activeDot={{ r: 4, strokeWidth: 0 }}
                isAnimationActive={false}
                connectNulls={true}
                hide={hiddenSeries.has(series.key)}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Summary badges — clickable for drill-down */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {data.series.filter(s => {
          if (hiddenSeries.has(s.key)) return false;
          if (hideZero && (s.points.length === 0 || (s.points[s.points.length - 1]?.penetration_pct ?? 0) === 0)) return false;
          return true;
        }).map((series) => {
          const lastPoint = series.points[series.points.length - 1];
          const penetration = lastPoint?.penetration_pct ?? 0;
          const color = colorMap.get(series.key) ?? 'var(--ff-gray-500)';
          const pctFill = Math.min(penetration, 100);
          const daysActive = series.points.length > 0
            ? Math.round(
                (new Date(((series.points[series.points.length - 1]?.date ?? '') as string) + 'T00:00:00').getTime() -
                 new Date(((series.points[0]?.date ?? '') as string) + 'T00:00:00').getTime()) /
                (1000 * 60 * 60 * 24)
              )
            : 0;
          return (
            <button
              key={series.key}
              onClick={() => canDrillDown ? handleDrillDown(series) : undefined}
              disabled={!canDrillDown}
              className={`text-left p-3 rounded-xl border border-border bg-card transition-all ${
                canDrillDown ? 'hover:shadow-md hover:scale-[1.02] cursor-pointer' : 'cursor-default'
              }`}
              style={{ borderLeftColor: color, borderLeftWidth: '3px' }}
              aria-label={`${series.label}: ${penetration.toFixed(1)}% penetration${daysActive > 0 ? ` (${daysActive} days active)` : ''}${canDrillDown ? ', click to drill down' : ''}`}
              title={canDrillDown ? `Drill into ${series.label}` : series.label}
            >
              <p className="text-xs text-muted-foreground truncate">{series.label}</p>
              <p className="text-xl font-bold mt-0.5" style={{ color }}>
                {penetration.toFixed(1)}%
              </p>
              <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pctFill}%`, backgroundColor: color }}
                  aria-hidden="true"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {(lastPoint?.cumulative ?? 0).toLocaleString()} / {series.total_scope.toLocaleString()}
              </p>
              {daysActive > 0 && (
                <p className="text-xs text-muted-foreground/80 mt-0.5">
                  {daysActive}d active
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default PenetrationCurveReport;
