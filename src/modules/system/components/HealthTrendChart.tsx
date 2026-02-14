/**
 * Health Trend Chart Component
 * Displays historical health data as a simple visual chart
 */

import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';

interface HealthHistoryEntry {
  totalServices: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  healthPercentage: number;
}

interface HealthTrendData {
  entries: HealthHistoryEntry[];
  timestamps: string[];
}

interface HealthTrendChartProps {
  hours?: number;
  limit?: number;
}

export function HealthTrendChart({ hours = 24, limit = 48 }: HealthTrendChartProps) {
  const [data, setData] = useState<HealthTrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `/api/system/health?history=true&hours=${hours}&limit=${limit}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const historyData = await response.json();
      setData(historyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
    // Refresh every 5 minutes
    const interval = setInterval(fetchHistory, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [hours, limit]);

  if (loading && !data) {
    return (
      <div className="bg-white dark:bg-gray-800/5 rounded-xl border border-white/10 p-6">
        <div className="flex items-center gap-2 mb-4">
          <RefreshCw className="w-5 h-5 text-velocity-accent animate-spin" />
          <span className="text-white/60">Loading health history...</span>
        </div>
        <div className="h-32 bg-white dark:bg-gray-800/5 rounded animate-pulse" />
      </div>
    );
  }

  if (error || !data || data.entries.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800/5 rounded-xl border border-white/10 p-6">
        <h3 className="text-lg font-semibold text-white mb-2">Health Trend</h3>
        <p className="text-white/50 text-sm">
          {error || 'No historical data available yet. Data will appear after health checks run.'}
        </p>
      </div>
    );
  }

  // Calculate trend
  const latestPercentage = data.entries[0]?.healthPercentage || 0;
  const oldestPercentage = data.entries[data.entries.length - 1]?.healthPercentage || 0;
  const trend = latestPercentage - oldestPercentage;

  const TrendIcon = trend > 0 ? TrendingUp : trend < 0 ? TrendingDown : Minus;
  const trendColor = trend > 0 ? 'text-green-400' : trend < 0 ? 'text-red-400' : 'text-gray-400';

  // Calculate stats
  const avgPercentage = Math.round(
    data.entries.reduce((sum, e) => sum + e.healthPercentage, 0) / data.entries.length
  );
  const minPercentage = Math.min(...data.entries.map(e => e.healthPercentage));
  const maxPercentage = Math.max(...data.entries.map(e => e.healthPercentage));

  // Reverse entries for chronological order (oldest first)
  const chronologicalEntries = [...data.entries].reverse();

  return (
    <div className="bg-white dark:bg-gray-800/5 rounded-xl border border-white/10 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Health Trend (Last {hours}h)</h3>
        <div className={`flex items-center gap-1 ${trendColor}`}>
          <TrendIcon className="w-4 h-4" />
          <span className="text-sm font-medium">
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4 mb-4">
        <div className="text-center">
          <div className="text-2xl font-bold text-white">{latestPercentage}%</div>
          <div className="text-xs text-white/50">Current</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-white/70">{avgPercentage}%</div>
          <div className="text-xs text-white/50">Average</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-green-400">{maxPercentage}%</div>
          <div className="text-xs text-white/50">Max</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold text-red-400">{minPercentage}%</div>
          <div className="text-xs text-white/50">Min</div>
        </div>
      </div>

      {/* Simple Bar Chart */}
      <div className="h-24 flex items-end gap-0.5">
        {chronologicalEntries.map((entry, index) => {
          const height = Math.max(4, (entry.healthPercentage / 100) * 100);
          const bgColor =
            entry.healthPercentage >= 90
              ? 'bg-green-500'
              : entry.healthPercentage >= 70
                ? 'bg-yellow-500'
                : 'bg-red-500';

          return (
            <div
              key={index}
              className={`flex-1 ${bgColor} rounded-t opacity-70 hover:opacity-100 transition-opacity cursor-pointer`}
              style={{ height: `${height}%` }}
              title={`${entry.healthPercentage}% - ${entry.healthyCount}/${entry.totalServices} healthy`}
            />
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between mt-2 text-xs text-white/40">
        <span>{hours}h ago</span>
        <span>Now</span>
      </div>

      {/* Data points count */}
      <div className="mt-3 text-xs text-white/40 text-center">
        {data.entries.length} data points
      </div>
    </div>
  );
}

export default HealthTrendChart;
