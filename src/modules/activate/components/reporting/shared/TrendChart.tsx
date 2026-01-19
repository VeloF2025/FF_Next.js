/**
 * TrendChart - Recharts wrapper for line and bar charts
 *
 * Purpose: Unified chart component for trend visualization
 * Status: WORKING - Core component for reporting dashboard
 *
 * Supports:
 * - Line charts (single and multi-series)
 * - Bar charts (single and stacked)
 * - Area charts
 * - Custom tooltips
 * - Responsive sizing
 *
 * NLNH Confidence: HIGH
 */

'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

export type ChartType = 'line' | 'bar' | 'area';

export interface ChartSeries {
  /** Data key in the dataset */
  dataKey: string;
  /** Display name for legend */
  name: string;
  /** Color for the series */
  color: string;
  /** Stack ID for stacked bar charts */
  stackId?: string;
  /** Whether to hide this series initially */
  hidden?: boolean;
}

export interface TrendChartProps {
  /** Chart data array */
  data: Record<string, unknown>[];
  /** Series configuration */
  series: ChartSeries[];
  /** Chart type */
  type?: ChartType;
  /** X-axis data key */
  xAxisKey?: string;
  /** X-axis label */
  xAxisLabel?: string;
  /** Y-axis label */
  yAxisLabel?: string;
  /** Chart height */
  height?: number;
  /** Show grid lines */
  showGrid?: boolean;
  /** Show legend */
  showLegend?: boolean;
  /** Custom tooltip formatter */
  tooltipFormatter?: (value: number, name: string) => string;
  /** Loading state */
  isLoading?: boolean;
  /** Empty state message */
  emptyMessage?: string;
  /** Title above chart */
  title?: string;
  /** Subtitle/description */
  subtitle?: string;
  /** Target reference line value */
  targetValue?: number;
  /** Target label */
  targetLabel?: string;
}

// Default colors for chart series
const defaultColors = [
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#10B981', // green
  '#F59E0B', // yellow
  '#EF4444', // red
  '#06B6D4', // cyan
  '#EC4899', // pink
  '#F97316', // orange
];

export function TrendChart({
  data,
  series,
  type = 'line',
  xAxisKey = 'date',
  xAxisLabel,
  yAxisLabel,
  height = 300,
  showGrid = true,
  showLegend = true,
  tooltipFormatter,
  isLoading,
  emptyMessage = 'No data available',
  title,
  subtitle,
  targetValue,
  targetLabel = 'Target',
}: TrendChartProps) {
  // Assign default colors to series if not provided
  const seriesWithColors = useMemo(() => {
    return series.map((s, idx) => ({
      ...s,
      color: s.color || defaultColors[idx % defaultColors.length],
    }));
  }, [series]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {title && (
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse" />
        )}
        <div
          className="bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"
          style={{ height }}
        />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-2">
        {title && (
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        )}
        <div
          className="flex items-center justify-center bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
          style={{ height }}
        >
          <p className="text-gray-500 dark:text-gray-400">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: Array<{ value: number; name: string; color: string }>;
    label?: string;
  }) => {
    if (!active || !payload) return null;

    return (
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">
          {label}
        </p>
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-gray-600 dark:text-gray-400">
              {entry.name}:
            </span>
            <span className="font-medium text-gray-900 dark:text-white">
              {tooltipFormatter
                ? tooltipFormatter(entry.value, entry.name)
                : entry.value}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const commonProps = {
    data,
    margin: { top: 10, right: 30, left: 0, bottom: 0 },
  };

  const renderChart = () => {
    switch (type) {
      case 'bar':
        return (
          <BarChart {...commonProps}>
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-gray-200 dark:stroke-gray-700"
              />
            )}
            <XAxis
              dataKey={xAxisKey}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
              label={
                xAxisLabel
                  ? { value: xAxisLabel, position: 'bottom', offset: -5 }
                  : undefined
              }
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
              label={
                yAxisLabel
                  ? {
                      value: yAxisLabel,
                      angle: -90,
                      position: 'insideLeft',
                    }
                  : undefined
              }
            />
            <Tooltip content={<CustomTooltip />} />
            {showLegend && <Legend />}
            {seriesWithColors.map((s) => (
              <Bar
                key={s.dataKey}
                dataKey={s.dataKey}
                name={s.name}
                fill={s.color}
                stackId={s.stackId}
                radius={[4, 4, 0, 0]}
              />
            ))}
          </BarChart>
        );

      case 'area':
        return (
          <AreaChart {...commonProps}>
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-gray-200 dark:stroke-gray-700"
              />
            )}
            <XAxis
              dataKey={xAxisKey}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
            />
            <Tooltip content={<CustomTooltip />} />
            {showLegend && <Legend />}
            {seriesWithColors.map((s) => (
              <Area
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.3}
                stackId={s.stackId}
              />
            ))}
          </AreaChart>
        );

      case 'line':
      default:
        return (
          <LineChart {...commonProps}>
            {showGrid && (
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-gray-200 dark:stroke-gray-700"
              />
            )}
            <XAxis
              dataKey={xAxisKey}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'currentColor' }}
              tickLine={{ stroke: 'currentColor' }}
            />
            <Tooltip content={<CustomTooltip />} />
            {showLegend && <Legend />}
            {/* Target reference line */}
            {targetValue !== undefined && targetValue > 0 && (
              <ReferenceLine
                y={targetValue}
                stroke="#EF4444"
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{
                  value: `${targetLabel}: ${targetValue}`,
                  position: 'right',
                  fill: '#EF4444',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              />
            )}
            {seriesWithColors.map((s) => (
              <Line
                key={s.dataKey}
                type="monotone"
                dataKey={s.dataKey}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                dot={{ fill: s.color, strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        );
    }
  };

  return (
    <div className="space-y-2">
      {(title || subtitle) && (
        <div>
          {title && (
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div className="text-gray-600 dark:text-gray-400">
        <ResponsiveContainer width="100%" height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/**
 * FunnelChart - Visual funnel for workflow stages
 */
export interface FunnelStage {
  name: string;
  value: number;
  percentage: number;
  color?: string;
}

export interface FunnelChartProps {
  stages: FunnelStage[];
  height?: number;
  title?: string;
  isLoading?: boolean;
}

export function FunnelChart({
  stages,
  height = 300,
  title,
  isLoading,
}: FunnelChartProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {title && (
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse" />
        )}
        <div
          className="bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse"
          style={{ height }}
        />
      </div>
    );
  }

  if (!stages || stages.length === 0) {
    return (
      <div className="space-y-2">
        {title && (
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        )}
        <div
          className="flex items-center justify-center bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700"
          style={{ height }}
        >
          <p className="text-gray-500 dark:text-gray-400">No funnel data</p>
        </div>
      </div>
    );
  }

  const maxValue = stages[0]?.value || 1;

  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title}
        </h3>
      )}
      <div className="space-y-2">
        {stages.map((stage, idx) => {
          const width = Math.max(20, (stage.value / maxValue) * 100);
          const color = stage.color || defaultColors[idx % defaultColors.length];

          return (
            <div key={stage.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-gray-900 dark:text-white">
                  {stage.name}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {stage.value.toLocaleString()} ({stage.percentage}%)
                </span>
              </div>
              <div className="relative">
                <div
                  className="h-8 rounded transition-all duration-300 flex items-center justify-center"
                  style={{
                    width: `${width}%`,
                    backgroundColor: color,
                    marginLeft: `${(100 - width) / 2}%`,
                  }}
                >
                  <span className="text-white text-xs font-medium">
                    {stage.percentage}%
                  </span>
                </div>
                {idx < stages.length - 1 && (
                  <div className="absolute -bottom-1 left-1/2 transform -translate-x-1/2">
                    <svg
                      className="w-4 h-2 text-gray-300 dark:text-gray-600"
                      viewBox="0 0 16 8"
                    >
                      <path d="M0 0 L8 8 L16 0" fill="currentColor" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * GaugeChart - Circular progress gauge with target
 */
export interface GaugeChartProps {
  value: number;
  target?: number;
  label: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function GaugeChart({
  value,
  target = 100,
  label,
  color = '#3B82F6',
  size = 'md',
}: GaugeChartProps) {
  const sizes = {
    sm: { width: 80, stroke: 8 },
    md: { width: 120, stroke: 10 },
    lg: { width: 160, stroke: 12 },
  };

  const { width, stroke } = sizes[size];
  const radius = (width - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percentage = Math.min(100, Math.max(0, value));
  const offset = circumference - (percentage / 100) * circumference;

  // Determine color based on value vs target
  const getColor = () => {
    if (value >= target) return '#10B981'; // green
    if (value >= target * 0.8) return '#F59E0B'; // yellow
    return '#EF4444'; // red
  };

  const fillColor = color === 'auto' ? getColor() : color;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width, height: width }}>
        {/* Background circle */}
        <svg className="transform -rotate-90" width={width} height={width}>
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-gray-200 dark:text-gray-700"
          />
          {/* Progress circle */}
          <circle
            cx={width / 2}
            cy={width / 2}
            r={radius}
            fill="none"
            stroke={fillColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
          {/* Target marker */}
          {target !== undefined && target < 100 && (
            <circle
              cx={width / 2}
              cy={width / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeDasharray={`2 ${circumference - 2}`}
              strokeDashoffset={-((target / 100) * circumference)}
              className="text-gray-400 dark:text-gray-500"
            />
          )}
        </svg>
        {/* Center value */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={`font-bold ${
              size === 'sm'
                ? 'text-lg'
                : size === 'md'
                  ? 'text-2xl'
                  : 'text-3xl'
            }`}
            style={{ color: fillColor }}
          >
            {value}%
          </span>
        </div>
      </div>
      <span className="mt-2 text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      {target !== undefined && target !== 100 && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Target: {target}%
        </span>
      )}
    </div>
  );
}

export default TrendChart;
