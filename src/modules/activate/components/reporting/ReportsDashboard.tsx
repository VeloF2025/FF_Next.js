/**
 * ReportsDashboard - Main container for comprehensive reporting suite
 *
 * Purpose: Unified dashboard with 4 report categories
 * - Anomalies: WA-only, OES-only, serial mismatches, resubmissions
 * - Trends: Daily/weekly charts, completion velocity
 * - Team: Technician leaderboard, team comparison, compliance
 * - QA Funnel: Photo completion, VLM rates, cycle times
 *
 * Status: WORKING - Main dashboard container
 * NLNH Confidence: HIGH
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  TrendingUp,
  Users,
  Filter as FilterIcon,
  Calendar,
  RefreshCw,
  Download,
  WifiOff,
} from 'lucide-react';
import type { ReportCategory, ReportFilters } from '../../types/reporting.types';
import { useActivateData, getTodaySAST, getYesterdaySAST } from '../../context';

// Import report sections
import { AnomalyReports } from './AnomalyReports';
import { TrendReports } from './TrendReports';
import { TeamReports } from './TeamReports';
import { FunnelReports } from './FunnelReports';
import { OfflineDevicesReports } from './OfflineDevicesReports';

interface CategoryTab {
  id: ReportCategory;
  label: string;
  icon: typeof AlertTriangle;
  description: string;
}

const categories: CategoryTab[] = [
  {
    id: 'anomalies',
    label: 'Anomalies',
    icon: AlertTriangle,
    description: 'WA-only, OES-only, serial mismatches, resubmissions',
  },
  {
    id: 'trends',
    label: 'Trends',
    icon: TrendingUp,
    description: 'Daily/weekly charts, completion velocity',
  },
  {
    id: 'team',
    label: 'Team Performance',
    icon: Users,
    description: 'Technician rankings, compliance rates',
  },
  {
    id: 'funnel',
    label: 'QA Funnel',
    icon: FilterIcon,
    description: 'Photo completion, VLM rates, cycle times',
  },
  {
    id: 'offline',
    label: 'Offline Devices',
    icon: WifiOff,
    description: 'Offline device tracking, serial validation, match status',
  },
];

export function ReportsDashboard() {
  // Get shared filters from context
  const { filters: sharedFilters, projects } = useActivateData();

  // Active category
  const [activeCategory, setActiveCategory] = useState<ReportCategory>('anomalies');

  // Local filters
  const [filters, setFilters] = useState<ReportFilters>({
    dateFrom: getYesterdaySAST(), // Default to yesterday for reports
    dateTo: getTodaySAST(),
    project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
  });

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Sync project filter from context
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      project: sharedFilters.projectFilter !== 'all' ? sharedFilters.projectFilter : undefined,
    }));
  }, [sharedFilters.projectFilter]);

  // NOTE: Removed auto-refresh on lastRefreshAt change to prevent visual re-renders.
  // Reports now only refresh when user clicks "Refresh" button or changes filters.
  // The Dashboard tab still auto-refreshes via ActivateDataContext.

  // Quick filter handlers
  const handleQuickFilter = (filter: 'today' | 'yesterday' | 'last7days' | 'last30days') => {
    const todayStr = getTodaySAST();

    switch (filter) {
      case 'today':
        setFilters({ ...filters, dateFrom: todayStr, dateTo: todayStr });
        break;
      case 'yesterday': {
        const yesterdayStr = getYesterdaySAST();
        setFilters({ ...filters, dateFrom: yesterdayStr, dateTo: yesterdayStr });
        break;
      }
      case 'last7days': {
        const last7 = new Date(todayStr);
        last7.setDate(last7.getDate() - 7);
        setFilters({
          ...filters,
          dateFrom: last7.toISOString().split('T')[0] as string,
          dateTo: todayStr,
        });
        break;
      }
      case 'last30days': {
        const last30 = new Date(todayStr);
        last30.setDate(last30.getDate() - 30);
        setFilters({
          ...filters,
          dateFrom: last30.toISOString().split('T')[0] as string,
          dateTo: todayStr,
        });
        break;
      }
    }
  };

  // Get active quick filter
  const getActiveQuickFilter = (): string | null => {
    const todayStr = getTodaySAST();
    const yesterdayStr = getYesterdaySAST();
    const last7 = new Date(todayStr);
    last7.setDate(last7.getDate() - 7);
    const last7Str = last7.toISOString().split('T')[0] as string;
    const last30 = new Date(todayStr);
    last30.setDate(last30.getDate() - 30);
    const last30Str = last30.toISOString().split('T')[0] as string;

    if (filters.dateFrom === todayStr && filters.dateTo === todayStr) return 'today';
    if (filters.dateFrom === yesterdayStr && filters.dateTo === yesterdayStr) return 'yesterday';
    if (filters.dateFrom === last7Str && filters.dateTo === todayStr) return 'last7days';
    if (filters.dateFrom === last30Str && filters.dateTo === todayStr) return 'last30days';

    return null;
  };

  // Handle refresh
  const handleRefresh = useCallback(() => {
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
    // Let child components handle their own loading
    setTimeout(() => setIsLoading(false), 100);
  }, []);

  // Handle export (placeholder - will be implemented in Phase 6)
  const handleExport = useCallback(() => {
    // TODO: Implement export functionality
    alert('Export functionality coming soon!');
  }, []);

  return (
    <div className="space-y-6">
      {/* Category Navigation */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;

            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={cat.description}
              >
                <Icon className="h-4 w-4" />
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Category description */}
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {categories.find((c) => c.id === activeCategory)?.description}
        </p>
      </div>

      {/* Filters Bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Quick Filters */}
          <div className="flex flex-wrap gap-2">
            {['today', 'yesterday', 'last7days', 'last30days'].map((filter) => (
              <button
                key={filter}
                onClick={() =>
                  handleQuickFilter(filter as 'today' | 'yesterday' | 'last7days' | 'last30days')
                }
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  getActiveQuickFilter() === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {filter === 'today'
                  ? 'Today'
                  : filter === 'yesterday'
                    ? 'Yesterday'
                    : filter === 'last7days'
                      ? 'Last 7 Days'
                      : 'Last 30 Days'}
              </button>
            ))}
          </div>

          {/* Date Range Inputs */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          {/* Project Filter */}
          <select
            value={filters.project || ''}
            onChange={(e) =>
              setFilters({
                ...filters,
                project: e.target.value || undefined,
              })
            }
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="">All Projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          {/* Action Buttons */}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium hover:bg-green-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Report Content */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50">
        {activeCategory === 'anomalies' && (
          <AnomalyReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'trends' && (
          <TrendReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'team' && (
          <TeamReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'funnel' && (
          <FunnelReports filters={filters} refreshKey={refreshKey} />
        )}
        {activeCategory === 'offline' && (
          <OfflineDevicesReports filters={filters} refreshKey={refreshKey} />
        )}
      </div>
    </div>
  );
}

export default ReportsDashboard;
