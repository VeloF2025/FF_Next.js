/**
 * Activate Dashboard Component
 * Main entry page for Activate module (formerly DR Photo Unified)
 * Shows list of DRs from dr_photo_unified_reviews table
 * Users can click a DR to review or search for specific DRs
 *
 * Uses ActivateDataContext for shared state and auto-refresh
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Calendar, Download, Filter, X, LayoutDashboard, PlusCircle, FileSpreadsheet, BarChart3 } from 'lucide-react';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import { ManualDREntry } from './ManualDREntry';
import { OESImportTab } from './OESImportTab';
import { ReportsTab } from './reporting/ReportsTab';
import {
  ActivateDataProvider,
  useActivateData,
  getTodaySAST,
  getYesterdaySAST,
} from '../context';

type TabType = 'list' | 'manual-entry' | 'oes-import' | 'reports';

// ============================================================================
// WRAPPER COMPONENT (Provides Context)
// ============================================================================

export function DrListPage() {
  return (
    <ActivateDataProvider refreshInterval={30000} autoRefreshEnabled={true}>
      <DrListPageContent />
    </ActivateDataProvider>
  );
}

// ============================================================================
// MAIN CONTENT (Consumes Context)
// ============================================================================

function DrListPageContent() {
  const router = useRouter();

  // Get shared data from context
  const {
    drops,
    filteredDrops,
    dashboardStats,
    projectStats,
    dailyStats,
    pagination,
    filters,
    updateFilter,
    setFilters,
    clearFilters,
    currentPage,
    setCurrentPage,
    goToNextPage,
    goToPreviousPage,
    isLoading,
    error,
    refresh,
    lastRefreshAt,
    projects,
  } = useActivateData();

  // Local UI state
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('list');

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      updateFilter('searchTerm', searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, updateFilter]);

  // Quick filter handler
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

  // Handle DR selection
  const handleSelectDr = (dropNumber: string) => {
    router.push(`/activate/${dropNumber}`);
  };

  // Handle clear filters
  const handleClearFilters = () => {
    setSearchInput('');
    clearFilters();
  };

  // Export to CSV
  const handleExportCSV = () => {
    const csvRows = [];

    csvRows.push([
      'DR Number',
      'Project',
      'Agent',
      'Status',
      'Completed Photos',
      'Outstanding Photos',
      'Feedback Sent',
      'Created',
    ].join(','));

    filteredDrops.forEach(drop => {
      csvRows.push([
        drop.dropNumber,
        drop.project || '',
        drop.senderPhone || '',
        drop.status,
        drop.completedPhotos,
        drop.outstandingPhotos,
        drop.feedbackSent ? 'Yes' : 'No',
        new Date(drop.createdAt).toLocaleString(),
      ].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activations-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Format phone number for display
  const formatAgent = (phone: string | null) => {
    if (!phone) return 'Unknown';
    return phone.replace(/^27/, '0');
  };

  // Skeleton component
  const Skeleton = ({ className }: { className?: string }) => (
    <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded ${className || ''}`} />
  );

  const hasActiveFilters = filters.searchTerm || filters.dateFrom || filters.dateTo ||
    filters.statusFilter !== 'all' || filters.projectFilter !== 'all';

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error Loading DRs</h3>
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
              DR Photo Review
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Select a DR to review photos and quality assessments
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
              onClick={handleExportCSV}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors"
            >
              <Download className="h-4 w-4" />
              <span className="text-sm">EXPORT CSV</span>
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

        {/* Tab Navigation */}
        <div className="mb-6">
          <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveTab('list')}
              className={`flex items-center gap-2 px-6 py-3 font-medium text-sm transition-colors border-b-2 -mb-px ${
                activeTab === 'list'
                  ? 'text-blue-600 dark:text-blue-400 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 border-transparent hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
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
          </div>
        </div>

        {/* Manual Entry Tab Content */}
        {activeTab === 'manual-entry' && (
          <div className="mb-6">
            <ManualDREntry onDRsAdded={() => {
              refresh();
              setActiveTab('list');
            }} />
          </div>
        )}

        {/* OES Import Tab Content */}
        {activeTab === 'oes-import' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6 mb-6">
            <OESImportTab onImportComplete={() => {
              refresh();
            }} />
          </div>
        )}

        {/* Reports Tab Content */}
        {activeTab === 'reports' && (
          <ReportsTab />
        )}

        {/* List Tab Content */}
        {activeTab === 'list' && (
          <>
            {/* Search and Filters */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6 mb-6">
              <div className="flex flex-col gap-4">
                {/* Search Bar Row */}
                <div className="flex items-center gap-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500 h-5 w-5" />
                    <input
                      type="text"
                      placeholder="Search drop number..."
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
                    />
                  </div>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={`px-4 py-3 rounded-lg transition-colors flex items-center gap-2 ${
                      showFilters || hasActiveFilters
                        ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    <Filter className="h-5 w-5" />
                    Filters
                    {hasActiveFilters && (
                      <span className="ml-1 px-2 py-0.5 bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 rounded-full text-xs font-semibold">
                        Active
                      </span>
                    )}
                  </button>
                </div>

                {/* Filter Options */}
                {showFilters && (
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    {/* From Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        From Date
                      </label>
                      <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(e) => updateFilter('dateFrom', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    {/* To Date */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        To Date
                      </label>
                      <input
                        type="date"
                        value={filters.dateTo}
                        onChange={(e) => updateFilter('dateTo', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    {/* Status Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Status
                      </label>
                      <select
                        value={filters.statusFilter}
                        onChange={(e) => updateFilter('statusFilter', e.target.value as any)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="all">All Statuses</option>
                        <option value="incomplete">Incomplete</option>
                        <option value="complete">Complete</option>
                      </select>
                    </div>

                    {/* Project Filter */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Project
                      </label>
                      <select
                        value={filters.projectFilter}
                        onChange={(e) => updateFilter('projectFilter', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        <option value="all">All Projects</option>
                        {projects.map(project => (
                          <option key={project} value={project}>{project}</option>
                        ))}
                      </select>
                    </div>

                    {/* Clear Filters Button */}
                    {hasActiveFilters && (
                      <div className="md:col-span-4 flex justify-end">
                        <button
                          onClick={handleClearFilters}
                          className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
                        >
                          <X className="h-4 w-4" />
                          Clear All Filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Dashboard Stats - Order: Total, Installed, Activated, Incomplete, Complete */}
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

              {/* Incomplete - Not yet QA reviewed */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Incomplete</h3>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-500 mt-1">{dashboardStats.incomplete}</p>
                )}
              </div>

              {/* Complete - QA reviewed complete */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-4">
                <h3 className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Complete</h3>
                {isLoading ? (
                  <Skeleton className="h-8 w-16 mt-2" />
                ) : (
                  <p className="text-2xl font-bold text-green-600 dark:text-green-500 mt-1">{dashboardStats.complete}</p>
                )}
              </div>
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-yellow-600 dark:text-yellow-500 uppercase tracking-wider">Incomplete</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-green-600 dark:text-green-500 uppercase tracking-wider">Complete</th>
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
                        ).map((stat) => (
                          <tr key={stat.project} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                            <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{stat.project}</td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">{stat.total}</td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-blue-600 dark:text-blue-400">{stat.installed ?? 0}</td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-purple-600 dark:text-purple-400">{stat.activated ?? 0}</td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-yellow-600 dark:text-yellow-500">{stat.incomplete}</td>
                            <td className="px-4 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-500">{stat.complete}</td>
                          </tr>
                        ))}
                        {/* Summary Row */}
                        <tr className="bg-gray-100 dark:bg-gray-900/80 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">Total</td>
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
                            ).reduce((sum, s) => sum + s.incomplete, 0)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-bold text-green-600 dark:text-green-500">
                            {(filters.projectFilter !== 'all'
                              ? projectStats.filter(s => s.project === filters.projectFilter)
                              : projectStats
                            ).reduce((sum, s) => sum + s.complete, 0)}
                          </td>
                        </tr>
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* DR List */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 overflow-hidden">
              {/* Summary Header */}
              <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Showing {filteredDrops.length} of {pagination.totalCount > 0 ? pagination.totalCount : drops.length} drops
                    {pagination.totalPages > 1 && (
                      <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">
                        (Page {currentPage} of {pagination.totalPages})
                      </span>
                    )}
                  </h2>
                </div>
              </div>

              {/* List Content */}
              {isLoading ? (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={`dr-skeleton-${i}`} className="px-6 py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <Skeleton className="h-6 w-32" />
                          </div>
                          <div className="flex items-center gap-2">
                            <Skeleton className="h-4 w-24" />
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-4 w-36" />
                          </div>
                        </div>
                        <Skeleton className="h-7 w-20 rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : filteredDrops.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
                    <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No DRs Found</h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {hasActiveFilters
                      ? 'Try adjusting your filters to see more results.'
                      : 'DRs will appear here once they are received from WhatsApp Monitor.'}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredDrops.map((drop) => (
                    <button
                      key={drop.id}
                      onClick={() => handleSelectDr(drop.dropNumber)}
                      className="w-full text-left px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                              {drop.dropNumber}
                            </h3>
                            {drop.feedbackSent && (
                              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                                ✓ Feedback Sent
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                            <span>Project: <span className="font-medium text-gray-900 dark:text-white">{drop.project || 'Unknown'}</span></span>
                            <span>•</span>
                            <span>Agent: <span className="font-medium text-gray-900 dark:text-white">{formatAgent(drop.senderPhone)}</span></span>
                            <span>•</span>
                            <span>Created: <span className="font-medium text-gray-900 dark:text-white">{new Date(drop.createdAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                              hour12: true
                            })}</span></span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mt-1">
                            <span>Photos: {drop.completedPhotos}/{drop.completedPhotos + drop.outstandingPhotos}</span>
                          </div>
                        </div>

                        <div>
                          {drop.status === 'complete' ? (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                              Complete
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200">
                              Incomplete
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Pagination Controls */}
              {pagination.totalPages > 1 && !isLoading && (
                <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Page {currentPage} of {pagination.totalPages} • Showing {filteredDrops.length} drops per page
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={goToPreviousPage}
                        disabled={!pagination.hasPreviousPage}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          pagination.hasPreviousPage
                            ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        ← Previous
                      </button>
                      <button
                        onClick={goToNextPage}
                        disabled={!pagination.hasNextPage}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          pagination.hasNextPage
                            ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                            : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        Next →
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
