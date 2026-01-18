/**
 * QA Centre Page Component
 * Lists DRs for quality assurance review
 * Contains search, filters, DR list, and pagination
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Calendar, Download, Filter, X, ArrowLeft } from 'lucide-react';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import {
  ActivateDataProvider,
  useActivateData,
  getTodaySAST,
  getYesterdaySAST,
} from '../context';

// ============================================================================
// WRAPPER COMPONENT (Provides Context)
// ============================================================================

export function QaCentrePage() {
  return (
    <ActivateDataProvider refreshInterval={30000} autoRefreshEnabled={true}>
      <QaCentrePageContent />
    </ActivateDataProvider>
  );
}

// ============================================================================
// MAIN CONTENT (Consumes Context)
// ============================================================================

function QaCentrePageContent() {
  const router = useRouter();

  // Get shared data from context
  const {
    filteredDrops,
    pagination,
    filters,
    updateFilter,
    setFilters,
    clearFilters,
    currentPage,
    goToNextPage,
    goToPreviousPage,
    isLoading,
    error,
    refresh,
    lastRefreshAt,
    projects,
    drops,
  } = useActivateData();

  // Local UI state
  const [searchInput, setSearchInput] = useState('');
  const [showFilters, setShowFilters] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

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

  // Handle DR selection - navigate to QA Centre detail page
  const handleSelectDr = (dropNumber: string) => {
    router.push(`/activate/qa-centre/${dropNumber}`);
  };

  // Handle clear filters
  const handleClearFilters = () => {
    setSearchInput('');
    clearFilters();
  };

  // Export to CSV using API endpoint for full data with all fields
  const handleExportCSV = useCallback(async () => {
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
      a.download = `qa-centre-export-${filters.dateFrom || 'all'}-to-${filters.dateTo || 'all'}.csv`;
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
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/activate')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">
                QA Centre
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                Review and validate DR photos
              </p>
            </div>
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
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Export filtered data to CSV"
            >
              <Download className={`h-4 w-4 ${isExporting ? 'animate-bounce' : ''}`} />
              <span className="text-sm">{isExporting ? 'Exporting...' : 'Export CSV'}</span>
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

        {/* Quick Filter Buttons */}
        <div className="mb-4 flex gap-2">
          {(['today', 'yesterday', 'last7days', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => handleQuickFilter(filter)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                getActiveQuickFilter() === filter
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {filter === 'today' ? 'Today' : filter === 'yesterday' ? 'Yesterday' : filter === 'last7days' ? 'Last 7 days' : 'All'}
            </button>
          ))}
        </div>

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
                    onChange={(e) => updateFilter('statusFilter', e.target.value as 'all' | 'complete' | 'incomplete')}
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
                        <span>Photos: <span className="font-medium text-gray-900 dark:text-white">{drop.photoCount || 0}</span></span>
                        {drop.ontSerial && (
                          <>
                            <span>•</span>
                            <span>ONT: <span className="font-mono text-xs font-medium text-blue-600 dark:text-blue-400">{drop.ontSerial}</span></span>
                          </>
                        )}
                        {drop.upsSerial && (
                          <>
                            <span>•</span>
                            <span>UPS: <span className="font-mono text-xs font-medium text-purple-600 dark:text-purple-400">{drop.upsSerial}</span></span>
                          </>
                        )}
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
      </div>
    </div>
  );
}
