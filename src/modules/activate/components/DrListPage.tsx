/**
 * Activate Dashboard Component
 * Main entry page for Activate module (formerly DR Photo Unified)
 * Shows list of DRs from dr_photo_unified_reviews table
 * Users can click a DR to review or search for specific DRs
 */

'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, RefreshCw, Calendar, Download, Filter, X, LayoutDashboard, PlusCircle, FileSpreadsheet } from 'lucide-react';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import { ManualDREntry } from './ManualDREntry';
import { OESImportTab } from './OESImportTab';

type TabType = 'list' | 'manual-entry' | 'oes-import';

interface DrListItem {
  id: string;
  dropNumber: string;
  project: string | null;
  reviewDate: string;
  completedPhotos: number;
  outstandingPhotos: number;
  status: 'complete' | 'incomplete';
  feedbackSent: string | null;
  createdAt: string;
  submittedDate: string | null; // Date DR was submitted (for filtering)
  senderPhone: string | null;
}

interface DailyStat {
  project: string;
  date: string;
  total: number;
  complete: number;
  incomplete: number;
}

interface DashboardStats {
  totalDrops: number;
  incomplete: number;
  complete: number;
  totalFeedback: number;
}

interface ProjectStat {
  project: string;
  total: number;
  complete: number;
  incomplete: number;
}

export function DrListPage() {
  const router = useRouter();
  const [drops, setDrops] = useState<DrListItem[]>([]);
  const [filteredDrops, setFilteredDrops] = useState<DrListItem[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [projectStats, setProjectStats] = useState<ProjectStat[]>([]); // Complete stats from ALL records
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    totalDrops: 0,
    incomplete: 0,
    complete: 0,
    totalFeedback: 0,
  });

  // Helper to get today's date in SAST format
  const getTodaySAST = () => {
    const now = new Date();
    const sastOffset = 2 * 60; // SAST is UTC+2
    const sastTime = new Date(now.getTime() + (sastOffset * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
    return sastTime.toISOString().split('T')[0];
  };

  // Filter states - default to today's date
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState(''); // For debounced search
  const [dateFrom, setDateFrom] = useState(getTodaySAST);
  const [dateTo, setDateTo] = useState(getTodaySAST);
  const [statusFilter, setStatusFilter] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Active tab state
  const [activeTab, setActiveTab] = useState<TabType>('list');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPreviousPage, setHasPreviousPage] = useState(false);
  const [totalDropsFromApi, setTotalDropsFromApi] = useState(0);

  // Quick filter handler to set date ranges
  // Uses SAST (Africa/Johannesburg) timezone to match server
  const handleQuickFilter = (filter: 'today' | 'yesterday' | 'last7days' | 'all') => {
    // Get current date in SAST (UTC+2)
    const now = new Date();
    const sastOffset = 2 * 60; // SAST is UTC+2 (120 minutes)
    const sastTime = new Date(now.getTime() + (sastOffset * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));

    // Get today's date string in SAST
    const todayStr = sastTime.toISOString().split('T')[0];

    switch (filter) {
      case 'today': {
        setDateFrom(todayStr);
        setDateTo(todayStr);
        break;
      }
      case 'yesterday': {
        // Create a new date from today's SAST date string and subtract 1 day
        const yesterdayDate = new Date(todayStr);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        const yesterdayStr = yesterdayDate.toISOString().split('T')[0];
        setDateFrom(yesterdayStr);
        setDateTo(yesterdayStr);
        break;
      }
      case 'last7days': {
        // Create a new date from today's SAST date string and subtract 7 days
        const last7DaysDate = new Date(todayStr);
        last7DaysDate.setDate(last7DaysDate.getDate() - 7);
        const last7DaysStr = last7DaysDate.toISOString().split('T')[0];
        setDateFrom(last7DaysStr);
        setDateTo(todayStr);
        break;
      }
      case 'all':
        setDateFrom('');
        setDateTo('');
        break;
    }
  };

  // Get unique projects for filter dropdown
  const projects = Array.from(new Set(drops.map(d => d.project).filter(Boolean))) as string[];

  // Calculate dashboard stats from drops
  const calculateStats = (dropsList: DrListItem[]) => {
    const stats = {
      totalDrops: dropsList.length,
      incomplete: dropsList.filter(d => d.status === 'incomplete').length,
      complete: dropsList.filter(d => d.status === 'complete').length,
      totalFeedback: dropsList.filter(d => d.feedbackSent).length,
    };
    setDashboardStats(stats);

    // Calculate daily stats per project (using submitted_date)
    const dailyMap = new Map<string, DailyStat>();
    dropsList.forEach(drop => {
      const dateStr = drop.submittedDate || drop.createdAt;
      const date = new Date(dateStr).toLocaleDateString('en-ZA');
      const key = `${drop.project || 'Unknown'}_${date}`;

      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          project: drop.project || 'Unknown',
          date,
          total: 0,
          complete: 0,
          incomplete: 0,
        });
      }

      const stat = dailyMap.get(key)!;
      stat.total++;
      if (drop.status === 'complete') stat.complete++;
      if (drop.status === 'incomplete') stat.incomplete++;
    });

    setDailyStats(Array.from(dailyMap.values()).sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ));
  };

  // Fetch drops from DR Photo Unified API with pagination support
  const fetchDrops = async (showLoading = true, page = 1, filters?: {
    dateFrom?: string;
    dateTo?: string;
    project?: string;
    status?: string;
  }) => {
    try {
      if (showLoading) setIsLoading(true);
      setError(null);

      // Build query params with all filters
      const params = new URLSearchParams();
      params.set('page', page.toString());
      if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters?.dateTo) params.set('dateTo', filters.dateTo);
      if (filters?.project && filters.project !== 'all') params.set('project', filters.project);
      if (filters?.status && filters.status !== 'all') params.set('status', filters.status);

      // Fetch with pagination and filters from unified reviews table
      const response = await fetch(`/api/activate/drops?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch drops');

      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        // Transform API response to match DrListItem interface
        const transformedDrops = data.data.map((drop: any) => ({
          id: drop.id,
          dropNumber: drop.drop_number,
          project: drop.project,
          reviewDate: drop.updated_at,
          completedPhotos: drop.steps_completed || 0,
          outstandingPhotos: (drop.steps_total || 10) - (drop.steps_completed || 0),
          status: drop.is_complete ? 'complete' : 'incomplete',
          feedbackSent: drop.feedback_sent ? drop.feedback_sent_at : null,
          createdAt: drop.created_at,
          submittedDate: drop.submitted_date || null, // Date DR was submitted
          senderPhone: drop.sender_phone || null, // From WA Monitor via unified table
        }));

        setDrops(transformedDrops);
        setFilteredDrops(transformedDrops);

        // Update pagination state from API response
        if (data.pagination) {
          setCurrentPage(data.pagination.currentPage);
          setTotalPages(data.pagination.totalPages);
          setHasNextPage(data.pagination.hasNextPage);
          setHasPreviousPage(data.pagination.hasPreviousPage);
          setTotalDropsFromApi(data.pagination.totalCount);
        }

        // Use API summary for stats (calculated from ALL drops, not just current page)
        if (data.summary) {
          // Set dashboard stats from API summary (all drops)
          setDashboardStats({
            totalDrops: data.summary.total_drops || 0,
            incomplete: data.summary.incomplete || 0,
            complete: data.summary.complete || 0,
            totalFeedback: data.summary.feedback_sent || 0,
          });

          // Set daily stats from API summary (all drops)
          setDailyStats(data.summary.dailyStats || []);
        } else {
          // Fallback: calculate from displayed drops if no summary provided
          calculateStats(transformedDrops);
        }

        // Set projectStats from API (now includes all filters)
        if (data.projectStats && Array.isArray(data.projectStats)) {
          setProjectStats(data.projectStats);
        }

        setLastRefresh(new Date());
      }
    } catch (err) {
      console.error('Error fetching drops:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch drops');
    } finally {
      if (showLoading) setIsLoading(false);
    }
  };


  // Debounced search - wait 300ms after typing stops
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput]);

  // Get current filters for API calls
  const getCurrentFilters = () => ({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    project: projectFilter !== 'all' ? projectFilter : undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  // Initial load - dates already initialized to today via useState
  useEffect(() => {
    fetchDrops(true, 1, getCurrentFilters());
  }, []);

  // Apply all filters and update stats
  // Note: This effect should NOT depend on `drops` to avoid resetting pagination
  // when new data is fetched for the current page
  useEffect(() => {
    let filtered = [...drops];

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(drop =>
        drop.dropNumber.toLowerCase().includes(term) ||
        drop.project?.toLowerCase().includes(term)
      );
    }

    // Date range filter using submitted_date (the date DR was actually submitted)
    // Note: submitted_date comes as UTC timestamp (e.g., '2026-01-15T22:00:00.000Z' for Jan 16 SAST)
    // We need to parse it in local timezone to get the correct date
    if (dateFrom) {
      filtered = filtered.filter(drop => {
        if (!drop.submittedDate) return false;
        // Parse as local date to handle timezone correctly
        const d = new Date(drop.submittedDate);
        const dropDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return dropDate >= dateFrom;
      });
    }
    if (dateTo) {
      filtered = filtered.filter(drop => {
        if (!drop.submittedDate) return false;
        // Parse as local date to handle timezone correctly
        const d = new Date(drop.submittedDate);
        const dropDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return dropDate <= dateTo;
      });
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(drop => drop.status === statusFilter);
    }

    // Project filter
    if (projectFilter !== 'all') {
      filtered = filtered.filter(drop => drop.project === projectFilter);
    }

    setFilteredDrops(filtered);

    // NOTE: Dashboard stats are now calculated server-side with filters
    // Client-side filtering only applies search term to the paginated results

    // Calculate daily stats from filtered drops for the table
    const dailyMap = new Map<string, DailyStat>();
    filtered.forEach(drop => {
      // Use submitted_date for grouping (the date DR was submitted, not created in system)
      // Parse in local timezone to handle UTC offset correctly
      const dateStr = drop.submittedDate || drop.createdAt;
      const d = new Date(dateStr);
      const dropDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const key = `${drop.project || 'Unknown'}_${dropDate}`;

      if (!dailyMap.has(key)) {
        dailyMap.set(key, {
          project: drop.project || 'Unknown',
          date: dropDate,
          total: 0,
          complete: 0,
          incomplete: 0,
        });
      }

      const stat = dailyMap.get(key)!;
      stat.total++;
      if (drop.status === 'complete') stat.complete++;
      if (drop.status === 'incomplete') stat.incomplete++;
    });

    setDailyStats(Array.from(dailyMap.values()).sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ));
  }, [drops, searchTerm, dateFrom, dateTo, statusFilter, projectFilter]);

  // Re-fetch when FILTER values change
  useEffect(() => {
    // Fetch with new filters, reset to page 1
    setCurrentPage(1);
    fetchDrops(true, 1, getCurrentFilters());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, statusFilter, projectFilter]);

  // Handle DR selection
  const handleSelectDr = (dropNumber: string) => {
    router.push(`/activate/${dropNumber}`);
  };

  // Manual refresh
  const handleRefresh = () => {
    fetchDrops(true, currentPage, getCurrentFilters());
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSearchTerm('');
    setSearchInput(''); // Clear debounced search input too
    setDateFrom('');
    setDateTo('');
    setStatusFilter('all');
    setProjectFilter('all');
    setCurrentPage(1); // Reset to first page when clearing filters
  };

  // Pagination handlers
  const handleNextPage = () => {
    if (hasNextPage) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      fetchDrops(true, nextPage, getCurrentFilters());
    }
  };

  const handlePreviousPage = () => {
    if (hasPreviousPage) {
      const prevPage = currentPage - 1;
      setCurrentPage(prevPage);
      fetchDrops(true, prevPage, getCurrentFilters());
    }
  };

  // Determine active quick filter based on current date range
  // Uses SAST timezone (UTC+2) to match handleQuickFilter()
  const getActiveQuickFilter = (): 'today' | 'yesterday' | 'last7days' | 'all' => {
    if (!dateFrom && !dateTo) return 'all';

    // Get current date in SAST (UTC+2) - same calculation as handleQuickFilter
    const now = new Date();
    const sastOffset = 2 * 60; // SAST is UTC+2 (120 minutes)
    const sastTime = new Date(now.getTime() + (sastOffset * 60 * 1000) + (now.getTimezoneOffset() * 60 * 1000));
    const todayStr = sastTime.toISOString().split('T')[0];

    // Calculate yesterday in SAST
    const yesterdaySast = new Date(sastTime);
    yesterdaySast.setDate(yesterdaySast.getDate() - 1);
    const yesterdayStr = yesterdaySast.toISOString().split('T')[0];

    // Calculate 7 days ago in SAST
    const last7DaysSast = new Date(sastTime);
    last7DaysSast.setDate(last7DaysSast.getDate() - 7);
    const last7DaysStr = last7DaysSast.toISOString().split('T')[0];

    if (dateFrom === todayStr && dateTo === todayStr) return 'today';
    if (dateFrom === yesterdayStr && dateTo === yesterdayStr) return 'yesterday';
    if (dateFrom === last7DaysStr && dateTo === todayStr) return 'last7days';

    return 'all';
  };

  // Export to CSV
  const handleExportCSV = () => {
    const csvRows = [];

    // Headers
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

    // Data rows
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

    // Create blob and download
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
    return phone.replace(/^27/, '0'); // Convert 27727655403 to 0727655403
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading DRs...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
            <h3 className="text-red-800 dark:text-red-200 font-semibold mb-2">Error Loading DRs</h3>
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-4 px-4 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const hasActiveFilters = searchTerm || dateFrom || dateTo || statusFilter !== 'all' || projectFilter !== 'all';

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
              onClick={handleRefresh}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className="h-4 w-4 text-gray-600 dark:text-gray-400" />
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
            {lastRefresh && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Calendar className="h-4 w-4" />
                Last updated: {lastRefresh.toLocaleTimeString()}
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
          </div>
        </div>

        {/* Manual Entry Tab Content */}
        {activeTab === 'manual-entry' && (
          <div className="mb-6">
            <ManualDREntry onDRsAdded={(count) => {
              fetchDrops(true, 1, getCurrentFilters());
              setActiveTab('list'); // Switch back to list after adding
            }} />
          </div>
        )}

        {/* OES Import Tab Content */}
        {activeTab === 'oes-import' && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6 mb-6">
            <OESImportTab onImportComplete={() => {
              fetchDrops(true, 1, getCurrentFilters());
            }} />
          </div>
        )}

        {/* List Tab Content */}
        {activeTab === 'list' && (
          <>
        {/* Search and Filters - MOVED TO TOP */}
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
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
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
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {/* Status Filter */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Status
                  </label>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
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
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
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

        {/* Dashboard Stats - AFTER FILTERS */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Drops</h3>
            </div>
            <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{dashboardStats.totalDrops}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Incomplete</h3>
            </div>
            <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-500 mt-2">{dashboardStats.incomplete}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Complete</h3>
            </div>
            <p className="text-3xl font-bold text-green-600 dark:text-green-500 mt-2">{dashboardStats.complete}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md dark:shadow-gray-900/50 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Total Feedback</h3>
            </div>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-500 mt-2">{dashboardStats.totalFeedback}</p>
          </div>
        </div>

        {/* Daily Stats Per Project - AFTER DASHBOARD STATS */}
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
              <button
                onClick={() => handleQuickFilter('today')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  getActiveQuickFilter() === 'today'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => handleQuickFilter('yesterday')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  getActiveQuickFilter() === 'yesterday'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Yesterday
              </button>
              <button
                onClick={() => handleQuickFilter('last7days')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  getActiveQuickFilter() === 'last7days'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Last 7 days
              </button>
              <button
                onClick={() => handleQuickFilter('all')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  getActiveQuickFilter() === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                All
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Total
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Complete
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Incomplete
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {projectStats.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                      No data available for the selected filters.
                    </td>
                  </tr>
                ) : (
                  (() => {
                    // Filter projectStats by project filter if active
                    const filteredProjectStats = projectFilter !== 'all'
                      ? projectStats.filter(stat => stat.project === projectFilter)
                      : projectStats;

                    // Calculate grand totals from filtered stats
                    const grandTotal = filteredProjectStats.reduce(
                      (sum, stat) => ({
                        total: sum.total + stat.total,
                        complete: sum.complete + stat.complete,
                        incomplete: sum.incomplete + stat.incomplete,
                      }),
                      { total: 0, complete: 0, incomplete: 0 }
                    );

                    const projectRows = filteredProjectStats.map((stat) => (
                        <tr key={stat.project} className="hover:bg-gray-50 dark:hover:bg-gray-900/30">
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                            {stat.project}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                            {stat.total}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 dark:text-green-500">
                            {stat.complete}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-yellow-600 dark:text-yellow-500">
                            {stat.incomplete}
                          </td>
                        </tr>
                      ));

                    // Add summary row
                    const summaryRow = (
                      <tr key="summary" className="bg-gray-100 dark:bg-gray-900/80 font-semibold border-t-2 border-gray-300 dark:border-gray-600">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">
                          Total
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-white">
                          {grandTotal.total}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-green-600 dark:text-green-500">
                          {grandTotal.complete}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-yellow-600 dark:text-yellow-500">
                          {grandTotal.incomplete}
                        </td>
                      </tr>
                    );

                    return [...projectRows, summaryRow];
                  })()
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
                Showing {filteredDrops.length} of {totalDropsFromApi > 0 ? totalDropsFromApi : drops.length} drops
                {totalPages > 1 && (
                  <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">
                    (Page {currentPage} of {totalPages})
                  </span>
                )}
              </h2>
            </div>
          </div>

          {/* List Content */}
          {filteredDrops.length === 0 ? (
            <div className="p-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
                <Search className="h-8 w-8 text-gray-400 dark:text-gray-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                No DRs Found
              </h3>
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
                    {/* DR Info */}
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
                        <span>
                          Photos: {drop.completedPhotos}/{drop.completedPhotos + drop.outstandingPhotos}
                        </span>
                      </div>
                    </div>

                    {/* Status Badge */}
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
          {totalPages > 1 && !isLoading && (
            <div className="bg-gray-50 dark:bg-gray-900/50 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Page {currentPage} of {totalPages} • Showing {filteredDrops.length} drops per page
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handlePreviousPage}
                    disabled={!hasPreviousPage}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      hasPreviousPage
                        ? 'bg-blue-600 dark:bg-blue-500 text-white hover:bg-blue-700 dark:hover:bg-blue-600'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    ← Previous
                  </button>
                  <button
                    onClick={handleNextPage}
                    disabled={!hasNextPage}
                    className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                      hasNextPage
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
