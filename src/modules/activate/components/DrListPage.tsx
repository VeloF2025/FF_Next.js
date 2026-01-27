/**
 * Activate Dashboard Component
 * Main entry page for Activate module
 * Shows stats overview with expandable project/zone/pon breakdown
 * Tab navigation is handled by ModulePage - this component receives showTab prop
 *
 * Uses ActivateDataContext for shared state and auto-refresh
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Calendar, Filter, X, Download, ChevronRight, ChevronDown, Layers, Wifi, Radio, Eye, CheckCircle } from 'lucide-react';
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';
import type { ZoneBreakdown } from '../types/reporting.types';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import { ReportsDashboard } from './reporting/ReportsDashboard';
import {
  ActivateDataProvider,
  useActivateData,
  getTodaySAST,
  getYesterdaySAST,
} from '../context';

type TabType = 'dashboard' | 'reports';

interface DrListPageProps {
  /** Which tab content to show - controlled by parent ModulePage */
  showTab?: TabType;
}

// ============================================================================
// WRAPPER COMPONENT (Provides Context)
// ============================================================================

export function DrListPage({ showTab = 'dashboard' }: DrListPageProps) {
  return (
    <ActivateDataProvider refreshInterval={30000} autoRefreshEnabled={true}>
      <DashboardPageContent showTab={showTab} />
    </ActivateDataProvider>
  );
}

// ============================================================================
// MAIN CONTENT (Consumes Context)
// ============================================================================

function DashboardPageContent({ showTab }: { showTab: TabType }) {
  const router = useRouter();

  // Get shared data from context
  const {
    dashboardStats,
    projectStats,
    projects,
    filters,
    setFilters,
    isLoading,
    error,
    refresh,
    lastRefreshAt,
  } = useActivateData();

  // Local UI state - tab is now controlled by parent via showTab prop
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Expandable project rows state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [expandedPons, setExpandedPons] = useState<Set<string>>(new Set());
  const [expandedPoles, setExpandedPoles] = useState<Set<string>>(new Set());
  const [projectZoneData, setProjectZoneData] = useState<Record<string, ZoneBreakdown[]>>({});
  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(new Set());

  // Use projects from context (populated from API's activeProjects)
  // Falls back to deriving from projectStats if not available
  const uniqueProjects = projects.length > 0
    ? projects
    : projectStats.map(s => s.project).filter(Boolean);

  // Quick filter handler for project table
  const handleQuickFilter = useCallback((filter: 'today' | 'yesterday' | 'last7days' | 'all') => {
    const todayStr = getTodaySAST();

    switch (filter) {
      case 'today':
        setFilters(prev => ({ ...prev, dateFrom: todayStr, dateTo: todayStr }));
        break;
      case 'yesterday': {
        const yesterdayStr = getYesterdaySAST();
        setFilters(prev => ({ ...prev, dateFrom: yesterdayStr, dateTo: yesterdayStr }));
        break;
      }
      case 'last7days': {
        const last7DaysDate = new Date(todayStr);
        last7DaysDate.setDate(last7DaysDate.getDate() - 7);
        const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;
        setFilters(prev => ({ ...prev, dateFrom: last7DaysStr, dateTo: todayStr }));
        break;
      }
      case 'all':
        setFilters(prev => ({ ...prev, dateFrom: '', dateTo: '' }));
        break;
    }
  }, [setFilters]);

  // Get active quick filter
  const getActiveQuickFilter = (): 'today' | 'yesterday' | 'last7days' | 'all' => {
    if (!filters.dateFrom && !filters.dateTo) return 'all';

    const todayStr = getTodaySAST();
    const yesterdayStr = getYesterdaySAST();
    const last7DaysDate = new Date(todayStr);
    last7DaysDate.setDate(last7DaysDate.getDate() - 7);
    const last7DaysStr = last7DaysDate.toISOString().split('T')[0] as string;

    if (filters.dateFrom === todayStr && filters.dateTo === todayStr) return 'today';
    if (filters.dateFrom === yesterdayStr && filters.dateTo === yesterdayStr) return 'yesterday';
    if (filters.dateFrom === last7DaysStr && filters.dateTo === todayStr) return 'last7days';

    return 'all';
  };

  const hasActiveFilters = filters.dateFrom || filters.dateTo ||
    filters.statusFilter !== 'all' || filters.projectFilter !== 'all';

  // Clear all filters
  const handleClearFilters = useCallback(() => {
    setFilters({
      searchTerm: '',
      dateFrom: getTodaySAST(),
      dateTo: getTodaySAST(),
      statusFilter: 'all',
      projectFilter: 'all',
    });
  }, [setFilters]);

  // Toggle project expansion and fetch zone data if needed
  const toggleProject = useCallback(async (project: string) => {
    const newExpanded = new Set(expandedProjects);

    if (newExpanded.has(project)) {
      // Collapse
      newExpanded.delete(project);
      setExpandedProjects(newExpanded);
    } else {
      // Expand and fetch zone data if not already loaded
      newExpanded.add(project);
      setExpandedProjects(newExpanded);

      if (!projectZoneData[project]) {
        // Fetch zone breakdown for this project
        setLoadingProjects(prev => new Set(prev).add(project));
        try {
          const params = new URLSearchParams();
          params.set('dateFrom', filters.dateFrom || getTodaySAST());
          params.set('dateTo', filters.dateTo || getTodaySAST());
          params.set('project', project);

          const response = await fetch(`/api/activate/reporting/daily-counts?${params.toString()}`);
          if (response.ok) {
            const data = await response.json();
            // Get zones from the first (only) project in response
            const zones = data.projects?.[0]?.zones || [];
            setProjectZoneData(prev => ({ ...prev, [project]: zones }));
          }
        } catch (err) {
          console.error('Failed to fetch zone data:', err);
        } finally {
          setLoadingProjects(prev => {
            const next = new Set(prev);
            next.delete(project);
            return next;
          });
        }
      }
    }
  }, [expandedProjects, projectZoneData, filters.dateFrom, filters.dateTo]);

  // Toggle zone expansion
  const toggleZone = useCallback((zoneKey: string) => {
    const newExpanded = new Set(expandedZones);
    if (newExpanded.has(zoneKey)) {
      newExpanded.delete(zoneKey);
    } else {
      newExpanded.add(zoneKey);
    }
    setExpandedZones(newExpanded);
  }, [expandedZones]);

  // Toggle PON expansion to show poles
  const togglePon = useCallback((ponKey: string) => {
    const newExpanded = new Set(expandedPons);
    if (newExpanded.has(ponKey)) {
      newExpanded.delete(ponKey);
    } else {
      newExpanded.add(ponKey);
    }
    setExpandedPons(newExpanded);
  }, [expandedPons]);

  // Toggle Pole expansion to show individual DRs
  const togglePole = useCallback((poleKey: string) => {
    const newExpanded = new Set(expandedPoles);
    if (newExpanded.has(poleKey)) {
      newExpanded.delete(poleKey);
    } else {
      newExpanded.add(poleKey);
    }
    setExpandedPoles(newExpanded);
  }, [expandedPoles]);

  // Export filtered data to Excel
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.projectFilter !== 'all') params.set('project', filters.projectFilter);
      if (filters.statusFilter !== 'all') params.set('status', filters.statusFilter);
      if (filters.qaStatusFilter !== 'all') params.set('qaStatus', filters.qaStatusFilter);
      if (filters.serialStatusFilter !== 'all') params.set('serialStatus', filters.serialStatusFilter);
      if (filters.resubmissionsOnly) params.set('resubmissionsOnly', 'true');

      const url = `/api/activate/export?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Build descriptive filename with active filters
      const parts: string[] = ['activate-dashboard'];
      if (filters.projectFilter !== 'all') parts.push(filters.projectFilter.replace(/\s+/g, '-'));
      if (filters.statusFilter !== 'all') parts.push(filters.statusFilter);
      if (filters.qaStatusFilter !== 'all') parts.push(`qa-${filters.qaStatusFilter}`);
      if (filters.serialStatusFilter !== 'all') parts.push(`serial-${filters.serialStatusFilter}`);
      if (filters.resubmissionsOnly) parts.push('resubmissions');
      if (filters.dateFrom) parts.push(filters.dateFrom);
      if (filters.dateTo) parts.push(`to-${filters.dateTo}`);
      if (parts.length === 1) parts.push('all');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${parts.join('-')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Export error:', err);
      alert('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [filters]);

  // Skeleton component
  const Skeleton = ({ className }: { className?: string }) => (
    <div className={`animate-pulse bg-[var(--ff-bg-tertiary)] rounded ${className || ''}`} />
  );

  if (error) {
    return (
      <div className="space-y-6">
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6">
          <div className="flex items-start gap-3 mb-4">
            <X className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-400 mb-1">Error Loading Dashboard</h3>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          </div>
          <button
            onClick={refresh}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
        {/* Header - only show on dashboard tab */}
        {showTab === 'dashboard' && (
          <div className="flex justify-between items-center">
            <div>
              <button
                onClick={refresh}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] bg-[var(--ff-bg-secondary)] hover:bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Refresh data"
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        )}

        {/* System Health Status */}
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-[var(--ff-text-secondary)]">System Status:</span>
              <SystemHealthDashboard compact autoRefresh refreshInterval={60} />
            </div>
            {lastRefreshAt && (
              <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
                <Calendar className="h-4 w-4" />
                Last updated: {lastRefreshAt.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Tab Content */}
        {showTab === 'dashboard' && (
          <>
            {/* Dashboard Stats - Order: Total, Installed, Activated, Not Reviewed, Reviewed */}
            <StatsGrid
              cards={[
                {
                  title: 'Total Drops',
                  value: dashboardStats.totalDrops,
                  icon: Layers,
                  color: '#3B82F6',
                  subtitle: 'All drops',
                  description: 'Total drops across all projects',
                  variant: 'detailed',
                  isLoading,
                },
                {
                  title: 'Installed',
                  value: dashboardStats.installed,
                  icon: Wifi,
                  color: '#3B82F6',
                  subtitle: 'From WhatsApp',
                  description: 'DRs received via WhatsApp submissions',
                  variant: 'detailed',
                  isLoading,
                },
                {
                  title: 'Activated',
                  value: dashboardStats.activated,
                  icon: Radio,
                  color: '#8B5CF6',
                  subtitle: 'In OES report',
                  description: 'DRs confirmed in Nokia OES system',
                  variant: 'detailed',
                  isLoading,
                },
                {
                  title: 'Not Reviewed',
                  value: dashboardStats.notReviewed,
                  icon: Eye,
                  color: '#F59E0B',
                  subtitle: 'Pending QA',
                  description: 'DRs awaiting QA feedback',
                  variant: 'detailed',
                  isLoading,
                },
                {
                  title: 'Reviewed',
                  value: dashboardStats.reviewed,
                  icon: CheckCircle,
                  color: '#10B981',
                  subtitle: 'QA complete',
                  description: 'DRs with QA feedback sent',
                  variant: 'detailed',
                  isLoading,
                },
              ] as EnhancedStatCardProps[]}
              columns={5}
            />

            {/* Filter Panel */}
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
              <div className="flex items-center justify-between">
                {/* Search placeholder for consistency with QA Centre */}
                <div className="flex-1 max-w-md">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search drop number..."
                      className="w-full pl-10 pr-4 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:ring-2 focus:ring-[var(--ff-primary-500)] focus:border-transparent"
                      disabled
                      title="Use QA Centre for search"
                    />
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--ff-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                </div>

                <div className="flex gap-2">
                  {/* Filter Toggle Button */}
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                      showFilters || hasActiveFilters
                        ? 'bg-[var(--ff-primary-500)] text-white'
                        : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]/80'
                    }`}
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                    {hasActiveFilters && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-white text-[var(--ff-primary-500)] rounded-full">
                        Active
                      </span>
                    )}
                  </button>

                  {/* Export Button */}
                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={`Export ${hasActiveFilters ? 'filtered' : 'all'} data to Excel`}
                  >
                    <Download className={`h-4 w-4 ${isExporting ? 'animate-bounce' : ''}`} />
                    {isExporting ? 'Exporting...' : `Export ${filters.statusFilter !== 'all' ? filters.statusFilter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'All'} Excel`}
                  </button>
                </div>
              </div>

              {/* Expanded Filters */}
              {showFilters && (
                <div className="mt-4 pt-4 border-t border-[var(--ff-border-light)]">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* From Date */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        From Date
                      </label>
                      <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary-500)] focus:border-transparent"
                      />
                    </div>

                    {/* To Date */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        To Date
                      </label>
                      <input
                        type="date"
                        value={filters.dateTo}
                        onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary-500)] focus:border-transparent"
                      />
                    </div>

                    {/* Status Filter */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        Status
                      </label>
                      <select
                        value={filters.statusFilter}
                        onChange={(e) => setFilters(prev => ({ ...prev, statusFilter: e.target.value as 'all' | 'installed' | 'activated' | 'not_reviewed' | 'reviewed' }))}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary-500)] focus:border-transparent"
                      >
                        <option value="all">All Statuses</option>
                        <option value="installed">Installed</option>
                        <option value="activated">Activated</option>
                        <option value="not_reviewed">Not Reviewed</option>
                        <option value="reviewed">Reviewed</option>
                      </select>
                    </div>

                    {/* Project Filter */}
                    <div>
                      <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                        Project
                      </label>
                      <select
                        value={filters.projectFilter}
                        onChange={(e) => setFilters(prev => ({ ...prev, projectFilter: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-primary-500)] focus:border-transparent"
                      >
                        <option value="all">All Projects</option>
                        {uniqueProjects.map(project => (
                          <option key={project} value={project}>{project}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Clear Filters Button */}
                  <div className="flex justify-end mt-4">
                    <button
                      onClick={handleClearFilters}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
                    >
                      <X className="h-4 w-4" />
                      Clear All Filters
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Daily Stats Per Project */}
            <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Numbers per Project
                  {hasActiveFilters && (
                    <span className="ml-2 text-sm font-normal text-[var(--ff-text-secondary)]">
                      (Filtered Results)
                    </span>
                  )}
                </h2>

                {/* Quick Filter Buttons */}
                <div className="flex gap-2">
                  {(['today', 'yesterday', 'last7days', 'all'] as const).map((filter) => (
                    <button
                      key={filter}
                      onClick={() => handleQuickFilter(filter)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        getActiveQuickFilter() === filter
                          ? 'bg-[var(--ff-primary-500)] text-white'
                          : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)]/80'
                      }`}
                    >
                      {filter === 'today' ? 'Today' : filter === 'yesterday' ? 'Yesterday' : filter === 'last7days' ? 'Last 7 days' : 'All'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
                  <thead className="bg-[var(--ff-bg-tertiary)]">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Project</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-blue-500 uppercase tracking-wider">Installed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-purple-500 uppercase tracking-wider">Activated</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-yellow-500 uppercase tracking-wider">Not Reviewed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-green-500 uppercase tracking-wider">Reviewed</th>
                    </tr>
                  </thead>
                  <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
                    {isLoading ? (
                      Array.from({ length: 4 }).map((_, i) => (
                        <tr key={`skeleton-${i}`}>
                          <td className="px-4 py-4"><Skeleton className="h-5 w-24" /></td>
                          <td className="px-4 py-4"><Skeleton className="h-5 w-12" /></td>
                          <td className="px-4 py-4"><Skeleton className="h-5 w-12" /></td>
                          <td className="px-4 py-4"><Skeleton className="h-5 w-12" /></td>
                          <td className="px-4 py-4"><Skeleton className="h-5 w-12" /></td>
                          <td className="px-4 py-4"><Skeleton className="h-5 w-12" /></td>
                        </tr>
                      ))
                    ) : projectStats.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--ff-text-secondary)]">
                          No data available for the selected filters.
                        </td>
                      </tr>
                    ) : (
                      <>
                        {(filters.projectFilter !== 'all'
                          ? projectStats.filter(s => s.project === filters.projectFilter)
                          : projectStats
                        ).map((stat) => {
                          const isExpanded = expandedProjects.has(stat.project);
                          const isLoadingZones = loadingProjects.has(stat.project);
                          const zones = projectZoneData[stat.project] || [];

                          return (
                            <React.Fragment key={stat.project}>
                              {/* Project Row */}
                              <tr
                                className="hover:bg-[var(--ff-bg-tertiary)]/50 cursor-pointer"
                                onClick={() => toggleProject(stat.project)}
                              >
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-[var(--ff-text-primary)]">
                                  <div className="flex items-center gap-2">
                                    {isLoadingZones ? (
                                      <div className="animate-spin h-4 w-4 border-2 border-[var(--ff-primary-500)] border-t-transparent rounded-full" />
                                    ) : isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-[var(--ff-text-secondary)]" />
                                    )}
                                    {stat.project}
                                  </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-[var(--ff-text-primary)]">{stat.total}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-blue-500">{stat.installed ?? 0}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-purple-500">{stat.activated ?? 0}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-yellow-500">{stat.notReviewed}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-green-500">{stat.reviewed}</td>
                              </tr>

                              {/* Zone Rows (when expanded) */}
                              {isExpanded && zones.map((zone) => {
                                const zoneKey = `${stat.project}_${zone.zone_no}`;
                                const isZoneExpanded = expandedZones.has(zoneKey);

                                return (
                                  <React.Fragment key={zoneKey}>
                                    {/* Zone Row */}
                                    <tr
                                      className="bg-[var(--ff-bg-tertiary)]/30 hover:bg-[var(--ff-bg-tertiary)]/50 cursor-pointer"
                                      onClick={(e) => { e.stopPropagation(); toggleZone(zoneKey); }}
                                    >
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-[var(--ff-text-secondary)]">
                                        <div className="flex items-center gap-2 pl-6">
                                          {zone.pons && zone.pons.length > 0 ? (
                                            isZoneExpanded ? (
                                              <ChevronDown className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
                                            ) : (
                                              <ChevronRight className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
                                            )
                                          ) : (
                                            <span className="w-3" />
                                          )}
                                          {zone.zone_name}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-[var(--ff-text-tertiary)]">{zone.total}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-400">{zone.installed}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-purple-400">{zone.activated}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-yellow-400">{zone.notReviewed}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-green-400">{zone.reviewed}</td>
                                    </tr>

                                    {/* PON Rows (when zone expanded) */}
                                    {isZoneExpanded && zone.pons?.map((pon) => {
                                      const ponKey = `${zoneKey}_${pon.pon_no}`;
                                      const isPonExpanded = expandedPons.has(ponKey);
                                      const hasPoles = pon.poles && pon.poles.length > 0;

                                      return (
                                        <React.Fragment key={ponKey}>
                                          <tr
                                            className={`bg-[var(--ff-bg-tertiary)]/50 ${hasPoles ? 'cursor-pointer hover:bg-[var(--ff-bg-tertiary)]/70' : ''}`}
                                            onClick={(e) => { if (hasPoles) { e.stopPropagation(); togglePon(ponKey); } }}
                                          >
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-[var(--ff-text-tertiary)]">
                                              <div className="flex items-center gap-2 pl-12">
                                                {hasPoles ? (
                                                  isPonExpanded ? (
                                                    <ChevronDown className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
                                                  ) : (
                                                    <ChevronRight className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
                                                  )
                                                ) : (
                                                  <span className="w-3" />
                                                )}
                                                {pon.pon_name}
                                              </div>
                                            </td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-[var(--ff-text-tertiary)]">{pon.total}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-blue-400">{pon.installed}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-purple-400">{pon.activated}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-yellow-400">{pon.notReviewed}</td>
                                            <td className="px-4 py-2 whitespace-nowrap text-sm text-green-400">{pon.reviewed}</td>
                                          </tr>

                                          {/* Pole Rows (when PON expanded) */}
                                          {isPonExpanded && pon.poles?.map((pole) => {
                                            const poleKey = `${ponKey}_${pole.pole_no}`;
                                            const isPoleExpanded = expandedPoles.has(poleKey);
                                            const hasDrs = pole.drs && pole.drs.length > 0;

                                            return (
                                              <React.Fragment key={poleKey}>
                                                <tr
                                                  className={`bg-[var(--ff-bg-tertiary)]/60 ${hasDrs ? 'cursor-pointer hover:bg-[var(--ff-bg-tertiary)]/80' : ''}`}
                                                  onClick={(e) => { if (hasDrs) { e.stopPropagation(); togglePole(poleKey); } }}
                                                >
                                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-[var(--ff-text-tertiary)]">
                                                    <div className="pl-20 flex items-center gap-2">
                                                      {hasDrs ? (
                                                        isPoleExpanded ? (
                                                          <ChevronDown className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
                                                        ) : (
                                                          <ChevronRight className="h-3 w-3 text-[var(--ff-text-tertiary)]" />
                                                        )
                                                      ) : (
                                                        <span className="w-3 h-3 bg-[var(--ff-border-light)] rounded-full" style={{ width: '8px', height: '8px' }} />
                                                      )}
                                                      {pole.pole_name}
                                                    </div>
                                                  </td>
                                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-[var(--ff-text-tertiary)]">{pole.total}</td>
                                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-blue-300 dark:text-blue-400">{pole.installed}</td>
                                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-purple-300 dark:text-purple-400">{pole.activated}</td>
                                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-yellow-300 dark:text-yellow-400">{pole.notReviewed}</td>
                                                  <td className="px-4 py-2 whitespace-nowrap text-sm text-green-300 dark:text-green-400">{pole.reviewed}</td>
                                                </tr>

                                                {/* DR Rows (when Pole expanded) */}
                                                {isPoleExpanded && pole.drs?.map((dr) => (
                                                  <tr
                                                    key={`${poleKey}_${dr.drop_number}`}
                                                    className="bg-[var(--ff-bg-tertiary)]/80 cursor-pointer hover:bg-[var(--ff-primary-500)]/10"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      router.push(`/activate/qa-centre/${dr.drop_number}`);
                                                    }}
                                                  >
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                      <div className="pl-28 flex items-center gap-2">
                                                        <span className="text-[var(--ff-primary-500)] hover:underline font-mono">
                                                          {dr.drop_number}
                                                        </span>
                                                        {dr.qa_status === 'pass' && <span className="text-green-500 text-xs">✓</span>}
                                                        {dr.qa_status === 'fail' && <span className="text-red-500 text-xs">✗</span>}
                                                        {dr.qa_status === 'rework' && <span className="text-yellow-500 text-xs">↻</span>}
                                                      </div>
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-[var(--ff-text-tertiary)]">1</td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-blue-300 dark:text-blue-400">
                                                      {dr.is_installed ? 1 : 0}
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-purple-300 dark:text-purple-400">
                                                      {dr.is_activated ? 1 : 0}
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-yellow-300 dark:text-yellow-400">
                                                      {dr.is_reviewed ? 0 : 1}
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm text-green-300 dark:text-green-400">
                                                      {dr.is_reviewed ? 1 : 0}
                                                    </td>
                                                  </tr>
                                                ))}
                                              </React.Fragment>
                                            );
                                          })}
                                        </React.Fragment>
                                      );
                                    })}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                        {/* Summary Row */}
                        <tr className="bg-[var(--ff-bg-secondary)] font-semibold border-t-2 border-[var(--ff-border-light)]">
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-[var(--ff-text-primary)]">
                            <div className="pl-6">Total</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-[var(--ff-text-primary)]">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + s.total, 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-blue-500">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + (s.installed ?? 0), 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-purple-500">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + (s.activated ?? 0), 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-yellow-500">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + s.notReviewed, 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-green-500">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + s.reviewed, 0)}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </>
        )}

        {/* Reports Tab Content */}
        {showTab === 'reports' && (
          <ReportsDashboard />
        )}
    </div>
  );
}
