/**
 * FaultTrendAnalysis Component - Fault cause trend visualization
 *
 * 🟢 WORKING: Production-ready fault trend analysis component
 *
 * Features:
 * - Bar chart visualization of fault causes
 * - Percentage and count display
 * - Filtering by contractor liability
 * - Time range selection
 * - Scope filtering (pole/PON/zone)
 * - Summary statistics
 * - Export functionality
 * - Responsive design
 */

'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Download, Filter, TrendingUp, AlertTriangle, Loader2, FileBarChart } from 'lucide-react';
import { FaultCause } from '../../types/ticket';
import {
  getFaultCauseMetadata,
  isContractorLiable,
  FAULT_TREND_FILTERS,
  type FaultCauseStats,
  type FaultTrendFilter,
} from '../../constants/faultCauses';
import { cn } from '@/lib/utils';

interface FaultTrendAnalysisProps {
  /** Fault trend data */
  data: FaultCauseStats[];
  /** Whether data is loading */
  isLoading?: boolean;
  /** Selected time range */
  timeRange?: '7_days' | '30_days' | '90_days' | 'all';
  /** Callback when time range changes */
  onTimeRangeChange?: (range: string) => void;
  /** Callback when scope filter changes */
  onScopeChange?: (scope: string) => void;
  /** Callback when export is clicked */
  onExport?: () => void;
  /** Compact mode for smaller display */
  compact?: boolean;
}

/**
 * 🟢 WORKING: Fault trend analysis with visualization
 */
export function FaultTrendAnalysis({
  data,
  isLoading = false,
  timeRange = 'all',
  onTimeRangeChange,
  onScopeChange,
  onExport,
  compact = false,
}: FaultTrendAnalysisProps) {
  const [activeFilter, setActiveFilter] = useState<FaultTrendFilter>(FAULT_TREND_FILTERS.ALL);
  const [scopeFilter, setScopeFilter] = useState<string>('');

  // 🟢 WORKING: Filter data based on active filter
  const filteredData = useMemo(() => {
    if (activeFilter === FAULT_TREND_FILTERS.ALL) {
      return data;
    }

    if (activeFilter === FAULT_TREND_FILTERS.CONTRACTOR_LIABLE) {
      return data.filter((item) => item.contractorLiable);
    }

    if (activeFilter === FAULT_TREND_FILTERS.NON_CONTRACTOR) {
      return data.filter((item) => !item.contractorLiable);
    }

    if (activeFilter === FAULT_TREND_FILTERS.MATERIAL_ISSUES) {
      return data.filter((item) => item.cause === FaultCause.MATERIAL_FAILURE);
    }

    if (activeFilter === FAULT_TREND_FILTERS.EXTERNAL_DAMAGE) {
      return data.filter((item) =>
        [FaultCause.THIRD_PARTY, FaultCause.ENVIRONMENTAL, FaultCause.VANDALISM].includes(item.cause)
      );
    }

    return data;
  }, [data, activeFilter]);

  // 🟢 WORKING: Calculate summary statistics
  const summary = useMemo(() => {
    const total = data.reduce((sum, item) => sum + item.count, 0);
    const contractorLiableCount = data
      .filter((item) => item.contractorLiable)
      .reduce((sum, item) => sum + item.count, 0);
    const contractorLiablePercentage = total > 0 ? Math.round((contractorLiableCount / total) * 100) : 0;

    const topCause = data.length > 0 ? data.reduce((max, item) => (item.count > max.count ? item : max)) : null;

    return {
      total,
      contractorLiableCount,
      contractorLiablePercentage,
      topCause,
    };
  }, [data]);

  // 🟢 WORKING: Handle filter change
  const handleFilterChange = useCallback((filter: FaultTrendFilter) => {
    setActiveFilter(filter);
  }, []);

  // 🟢 WORKING: Handle scope filter change
  const handleScopeFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setScopeFilter(value);
      if (onScopeChange) {
        onScopeChange(value);
      }
    },
    [onScopeChange]
  );

  // 🟢 WORKING: Handle time range change
  const handleTimeRangeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (onTimeRangeChange) {
        onTimeRangeChange(e.target.value);
      }
    },
    [onTimeRangeChange]
  );

  // 🟢 WORKING: Get color for fault cause bar
  const getBarColor = (cause: FaultCause): string => {
    const metadata = getFaultCauseMetadata(cause);
    const colorMap: Record<string, string> = {
      error: 'bg-red-500',
      warning: 'bg-yellow-500',
      info: 'bg-blue-500',
      success: 'bg-green-500',
      default: 'bg-[var(--ff-bg-tertiary)]',
    };
    return colorMap[metadata.color] || colorMap.default;
  };

  // 🟢 WORKING: Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <Loader2 className="w-6 h-6 text-[var(--ff-text-secondary)] animate-spin" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading fault trend data...</span>
      </div>
    );
  }

  // 🟢 WORKING: Empty state
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <FileBarChart className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-3" />
        <p className="text-[var(--ff-text-secondary)] text-center">
          No fault data available for the selected period.
        </p>
      </div>
    );
  }

  const timeRangeLabels: Record<string, string> = {
    '7_days': 'Last 7 Days',
    '30_days': 'Last 30 Days',
    '90_days': 'Last 90 Days',
    all: 'All Time',
  };

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Fault Trend Analysis</h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Time Range Selector */}
          <select
            role="combobox"
            aria-label="Time range"
            value={timeRange}
            onChange={handleTimeRangeChange}
            className={cn(
              'px-3 py-1.5 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg',
              'text-sm text-[var(--ff-text-primary)]',
              'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
              compact && 'text-xs px-2 py-1'
            )}
          >
            <option value="7_days">Last 7 Days</option>
            <option value="30_days">Last 30 Days</option>
            <option value="90_days">Last 90 Days</option>
            <option value="all">All Time</option>
          </select>

          {/* Export Button */}
          {onExport && (
            <button
              onClick={onExport}
              className={cn(
                'px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg',
                'text-sm text-blue-400 hover:bg-blue-500/20',
                'transition-all duration-200 flex items-center gap-1.5',
                compact && 'text-xs px-2 py-1'
              )}
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
            </button>
          )}
        </div>
      </div>

      {/* Summary Statistics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-3">
          <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Total Faults</p>
          <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{summary.total} total faults</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-3">
          <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Contractor Liable</p>
          <p className="text-2xl font-bold text-red-400">{summary.contractorLiablePercentage}% Contractor Liable</p>
        </div>

        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-3">
          <p className="text-xs text-[var(--ff-text-secondary)] mb-1">Top Cause</p>
          <p className="text-base font-semibold text-[var(--ff-text-primary)] truncate">
            Top Cause: {summary.topCause ? getFaultCauseMetadata(summary.topCause.cause).label : 'N/A'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-[var(--ff-text-secondary)]" />
        <button
          onClick={() => handleFilterChange(FAULT_TREND_FILTERS.ALL)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-all duration-200',
            activeFilter === FAULT_TREND_FILTERS.ALL
              ? 'bg-blue-500 text-[var(--ff-text-primary)]'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
          )}
        >
          All Faults
        </button>
        <button
          onClick={() => handleFilterChange(FAULT_TREND_FILTERS.CONTRACTOR_LIABLE)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-all duration-200',
            activeFilter === FAULT_TREND_FILTERS.CONTRACTOR_LIABLE
              ? 'bg-red-500 text-[var(--ff-text-primary)]'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
          )}
        >
          Contractor Liable
        </button>
        <button
          onClick={() => handleFilterChange(FAULT_TREND_FILTERS.NON_CONTRACTOR)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-sm transition-all duration-200',
            activeFilter === FAULT_TREND_FILTERS.NON_CONTRACTOR
              ? 'bg-green-500 text-[var(--ff-text-primary)]'
              : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]'
          )}
        >
          Non-Contractor
        </button>
      </div>

      {/* Scope Filter */}
      {onScopeChange && (
        <div>
          <input
            type="text"
            value={scopeFilter}
            onChange={handleScopeFilterChange}
            placeholder="Filter by Pole, PON, or Zone..."
            className={cn(
              'w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg',
              'text-sm text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)]',
              'focus:outline-none focus:ring-2 focus:ring-blue-500/50'
            )}
          />
        </div>
      )}

      {/* Chart */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="space-y-3">
          {filteredData.map((item) => {
            const metadata = getFaultCauseMetadata(item.cause);
            const maxCount = Math.max(...filteredData.map((d) => d.count));
            const barWidth = maxCount > 0 ? (item.count / maxCount) * 100 : 0;

            return (
              <div key={item.cause} className="space-y-1.5">
                {/* Label Row */}
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--ff-text-primary)] font-medium">{metadata.label}</span>
                    {item.contractorLiable && (
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[var(--ff-text-secondary)]">{item.count} faults</span>
                    <span className="text-[var(--ff-text-primary)] font-semibold min-w-[3rem] text-right">
                      {item.percentage}%
                    </span>
                  </div>
                </div>

                {/* Bar */}
                <div className="w-full h-8 bg-[var(--ff-bg-secondary)] rounded overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all duration-500 flex items-center justify-end px-2',
                      getBarColor(item.cause)
                    )}
                    style={{ width: `${barWidth}%` }}
                  >
                    {barWidth > 15 && (
                      <span className="text-xs font-semibold text-[var(--ff-text-primary)]">
                        {item.count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Time Range Display */}
      <div className="text-xs text-[var(--ff-text-tertiary)] text-center">
        Showing data for: {timeRangeLabels[timeRange] || timeRange}
      </div>
    </div>
  );
}
