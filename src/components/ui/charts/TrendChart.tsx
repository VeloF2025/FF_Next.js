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
import { defaultColors } from './chartColors';

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
          <div className="h-6 bg-secondary rounded w-48 animate-pulse" />
        )}
        <div
          className="bg-secondary rounded-lg animate-pulse"
          style={{ height }}
        />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="space-y-2">
        {title && (
          <h3 className="text-lg font-semibold text-foreground">
            {title}
          </h3>
        )}
        <div
          className="flex items-center justify-center bg-input/50 rounded-lg border border-border"
          style={{ height }}
        >
          <p className="text-muted-foreground">{emptyMessage}</p>
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
      <div className="bg-card border border-border rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium text-foreground mb-2">
          {label}
        </p>
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-muted-foreground">
              {entry.name}:
            </span>
            <span className="font-medium text-foreground">
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
            <h3 className="text-lg font-semibold text-foreground">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      )}
      <div className="text-muted-foreground">
        <ResponsiveContainer width="100%" height={height}>
          {renderChart()}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default TrendChart;
