/**
 * Activate Dashboard Component
 * Main entry page for Activate module
 * Shows stats overview and tabs: Dashboard, Reports, OES Import, Manual Entry
 * DR list has moved to QA Centre (/activate/qa-centre)
 *
 * Uses ActivateDataContext for shared state and auto-refresh
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, Calendar, LayoutDashboard, PlusCircle, FileSpreadsheet, BarChart3, Filter, X, Download, ChevronRight, ChevronDown } from 'lucide-react';
import type { ZoneBreakdown, PonBreakdown } from '../types/reporting.types';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import { ManualDREntry } from './ManualDREntry';
import { OESImportTab } from './OESImportTab';
import { ReportsDashboard } from './reporting/ReportsDashboard';
import {
  ActivateDataProvider,
  useActivateData,
  getTodaySAST,
  getYesterdaySAST,
} from '../context';

type TabType = 'dashboard' | 'reports' | 'oes-import' | 'manual-entry';

// ============================================================================
// WRAPPER COMPONENT (Provides Context)
// ============================================================================

export function DrListPage() {
  return (
    <ActivateDataProvider refreshInterval={30000} autoRefreshEnabled={true}>
      <DashboardPageContent />
    </ActivateDataProvider>
  );
}

// ============================================================================
// MAIN CONTENT (Consumes Context)
// ============================================================================

function DashboardPageContent() {
  const router = useRouter();

  // Get shared data from context
  const {
    dashboardStats,
    projectStats,
    filters,
    setFilters,
    isLoading,
    error,
    refresh,
    lastRefreshAt,
  } = useActivateData();

  // Local UI state
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [showFilters, setShowFilters] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Expandable project rows state
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [projectZoneData, setProjectZoneData] = useState<Record<string, ZoneBreakdown[]>>({});
  const [loadingProjects, setLoadingProjects] = useState<Set<string>>(new Set());

  // Get unique projects from projectStats for filter dropdown
  const uniqueProjects = projectStats.map(s => s.project).filter(Boolean);

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

  // Export filtered data to CSV
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams();
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.set('dateTo', filters.dateTo);
      if (filters.projectFilter !== 'all') params.set('project', filters.projectFilter);
      if (filters.statusFilter !== 'all') params.set('status', filters.statusFilter);

      const url = `/api/activate/export?${params.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Get the CSV content and trigger download
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `activate-export-${filters.dateFrom || 'all'}-to-${filters.dateTo || 'all'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [filters]);

  // Skeleton component
  const Skeleton = ({ className }: { className?: string }) => (
    <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className || ''}`} />
  );

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error Loading Dashboard</h3>
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={refresh}
              className="mt-4 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
              Activate Dashboard
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Overview of installations and activations
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={refresh}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className={`h-4 w-4 text-gray-600 dark:text-gray-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="text-sm text-gray-700 dark:text-gray-300">REFRESH</span>
            </button>
            <button
              onClick={() => router.push('/activate/qa-centre')}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            >
              <span className="text-sm">Open QA Centre</span>
            </button>
          </div>
        </div>

        {/* System Health Status */}
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">System Status:</span>
              <SystemHealthDashboard compact autoRefresh refreshInterval={60} />
            </div>
            {lastRefreshAt && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Calendar className="h-4 w-4" />
                Last updated: {lastRefreshAt.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* Tab Navigation - Reordered: Dashboard, Reports, OES Import, Manual Entry */}
        <div className="mb-6">
          <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
                activeTab === 'dashboard'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('reports')}
              className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
                activeTab === 'reports'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Reports
            </button>
            <button
              onClick={() => setActiveTab('oes-import')}
              className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
                activeTab === 'oes-import'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4" />
              OES Import
            </button>
            <button
              onClick={() => setActiveTab('manual-entry')}
              className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
                activeTab === 'manual-entry'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <PlusCircle className="h-4 w-4" />
              Manual Entry
            </button>
          </div>
        </div>

        {/* Dashboard Tab Content */}
        {activeTab === 'dashboard' && (
          <>
            {/* Dashboard Stats - Order: Total, Installed, Activated, Not Reviewed, Reviewed */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {/* Total Drops */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total Drops</h3>
                  {isLoading && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-gray-400" />}
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{dashboardStats.totalDrops}</p>
                )}
              </div>

              {/* Installed - DRs from WhatsApp */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Installed</h3>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">{dashboardStats.installed}</p>
                )}
              </div>

              {/* Activated - DRs in OES report */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Activated</h3>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{dashboardStats.activated}</p>
                )}
              </div>

              {/* Not Reviewed - Feedback not yet sent */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Not Reviewed</h3>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-500 mt-1">{dashboardStats.notReviewed}</p>
                )}
              </div>

              {/* Reviewed - QA feedback sent */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Reviewed</h3>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-green-600 dark:text-green-500 mt-1">{dashboardStats.reviewed}</p>
                )}
              </div>
            </div>

            {/* Filter Panel */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4 mb-6">
              <div className="flex items-center justify-between">
                {/* Search placeholder for consistency with QA Centre */}
                <div className="flex-1 max-w-md">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Search drop number..."
                      className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                      disabled
                      title="Use QA Centre for search"
                    />
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <Filter className="h-4 w-4" />
                    Filters
                    {hasActiveFilters && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs bg-white text-blue-600 rounded-full">
                        Active
                      </span>
                    )}
                  </button>

                  {/* Export Button */}
                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Export filtered data to Excel"
                  >
                    <Download className={`h-4 w-4 ${isExporting ? 'animate-bounce' : ''}`} />
                    {isExporting ? 'Exporting...' : 'Export Excel'}
                  </button>
                </div>
              </div>

              {/* Expanded Filters */}
              {showFilters && (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* From Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        From Date
                      </label>
                      <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(e) => setFilters(prev => ({ ...prev, dateFrom: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                      />
                    </div>

                    {/* To Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        To Date
                      </label>
                      <input
                        type="date"
                        value={filters.dateTo}
                        onChange={(e) => setFilters(prev => ({ ...prev, dateTo: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
                      />
                    </div>

                    {/* Status Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Status
                      </label>
                      <select
                        value={filters.statusFilter}
                        onChange={(e) => setFilters(prev => ({ ...prev, statusFilter: e.target.value as 'all' | 'installed' | 'activated' | 'not_reviewed' | 'reviewed' }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
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
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Project
                      </label>
                      <select
                        value={filters.projectFilter}
                        onChange={(e) => setFilters(prev => ({ ...prev, projectFilter: e.target.value }))}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent"
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
                      className="flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                    >
                      <X className="h-4 w-4" />
                      Clear All Filters
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Daily Stats Per Project */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Numbers per Project
                  {hasActiveFilters && (
                    <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
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
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {filter === 'today' ? 'Today' : filter === 'yesterday' ? 'Yesterday' : filter === 'last7days' ? 'Last 7 days' : 'All'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Project</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Installed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-purple-600 dark:text-purple-400 uppercase tracking-wider">Activated</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-yellow-600 dark:text-yellow-500 uppercase tracking-wider">Not Reviewed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-green-600 dark:text-green-500 uppercase tracking-wider">Reviewed</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
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
                        <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
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
                                className="hover:bg-gray-50 dark:hover:bg-gray-900/30 cursor-pointer"
                                onClick={() => toggleProject(stat.project)}
                              >
                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                                  <div className="flex items-center gap-2">
                                    {isLoadingZones ? (
                                      <div className="animate-spin h-4 w-4 border-2 border-gray-400 border-t-transparent rounded-full" />
                                    ) : isExpanded ? (
                                      <ChevronDown className="h-4 w-4 text-gray-500" />
                                    ) : (
                                      <ChevronRight className="h-4 w-4 text-gray-500" />
                                    )}
                                    {stat.project}
                                  </div>
                                </td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{stat.total}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">{stat.installed ?? 0}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-purple-600 dark:text-purple-400">{stat.activated ?? 0}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-yellow-600 dark:text-yellow-500">{stat.notReviewed}</td>
                                <td className="px-4 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-500">{stat.reviewed}</td>
                              </tr>

                              {/* Zone Rows (when expanded) */}
                              {isExpanded && zones.map((zone) => {
                                const zoneKey = `${stat.project}_${zone.zone_no}`;
                                const isZoneExpanded = expandedZones.has(zoneKey);

                                return (
                                  <React.Fragment key={zoneKey}>
                                    {/* Zone Row */}
                                    <tr
                                      className="bg-gray-50 dark:bg-gray-900/20 hover:bg-gray-100 dark:hover:bg-gray-900/40 cursor-pointer"
                                      onClick={(e) => { e.stopPropagation(); toggleZone(zoneKey); }}
                                    >
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                                        <div className="flex items-center gap-2 pl-6">
                                          {zone.pons && zone.pons.length > 0 ? (
                                            isZoneExpanded ? (
                                              <ChevronDown className="h-3 w-3 text-gray-400" />
                                            ) : (
                                              <ChevronRight className="h-3 w-3 text-gray-400" />
                                            )
                                          ) : (
                                            <span className="w-3" />
                                          )}
                                          {zone.zone_name}
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{zone.total}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-blue-500 dark:text-blue-400">{zone.installed}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-purple-500 dark:text-purple-400">{zone.activated}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-yellow-500 dark:text-yellow-400">{zone.notReviewed}</td>
                                      <td className="px-4 py-3 whitespace-nowrap text-sm text-green-500 dark:text-green-400">{zone.reviewed}</td>
                                    </tr>

                                    {/* PON Rows (when zone expanded) */}
                                    {isZoneExpanded && zone.pons?.map((pon) => (
                                      <tr
                                        key={`${zoneKey}_${pon.pon_no}`}
                                        className="bg-gray-100 dark:bg-gray-900/40"
                                      >
                                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                                          <div className="pl-14">{pon.pon_name}</div>
                                        </td>
                                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{pon.total}</td>
                                        <td className="px-4 py-2 whitespace-nowrap text-sm text-blue-400 dark:text-blue-300">{pon.installed}</td>
                                        <td className="px-4 py-2 whitespace-nowrap text-sm text-purple-400 dark:text-purple-300">{pon.activated}</td>
                                        <td className="px-4 py-2 whitespace-nowrap text-sm text-yellow-400 dark:text-yellow-300">{pon.notReviewed}</td>
                                        <td className="px-4 py-2 whitespace-nowrap text-sm text-green-400 dark:text-green-300">{pon.reviewed}</td>
                                      </tr>
                                    ))}
                                  </React.Fragment>
                                );
                              })}
                            </React.Fragment>
                          );
                        })}
                        {/* Summary Row */}
                        <tr className="bg-gray-100 dark:bg-gray-900/80 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">
                            <div className="pl-6">Total</div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + s.total, 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-blue-600 dark:text-blue-400">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + (s.installed ?? 0), 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-purple-600 dark:text-purple-400">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + (s.activated ?? 0), 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-yellow-600 dark:text-yellow-500">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + s.notReviewed, 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-green-600 dark:text-green-500">
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

            {/* Call to Action - Go to QA Centre */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 text-center">
              <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-200 mb-2">
                Ready to review DRs?
              </h3>
              <p className="text-blue-700 dark:text-blue-300 mb-4">
                Head to the QA Centre to search, filter, and review individual drop receipts.
              </p>
              <button
                onClick={() => router.push('/activate/qa-centre')}
                className="px-6 py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors font-medium"
              >
                Go to QA Centre →
              </button>
            </div>
          </>
        )}

        {/* Reports Tab Content */}
        {activeTab === 'reports' && (
          <ReportsDashboard />
        )}

        {/* OES Import Tab Content */}
        {activeTab === 'oes-import' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6 mb-6">
            <OESImportTab onImportComplete={() => {
              refresh();
            }} />
          </div>
        )}

        {/* Manual Entry Tab Content */}
        {activeTab === 'manual-entry' && (
          <div className="mb-6">
            <ManualDREntry onDRsAdded={() => {
              refresh();
              setActiveTab('dashboard');
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
