/**
 * ActivateDataContext
 *
 * Provides shared data state and auto-refresh functionality
 * across all tabs in the Activate module.
 *
 * Features:
 * - Centralized data fetching for DR list, stats, and reports
 * - Background auto-refresh (30s interval, pauses when tab hidden)
 * - Silent updates without loading spinners
 * - All tabs stay in sync automatically
 */

'use client';

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  fetchDrops,
  getTodaySAST,
  type DrListItem,
  type DashboardStats,
  type ProjectStat,
  type DailyStat,
  type PaginationInfo,
  type DropsFilters,
} from '../services/activateDataService';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

// ============================================================================
// TYPES
// ============================================================================

export type StatusFilter = 'all' | 'installed' | 'activated' | 'not_reviewed' | 'reviewed';

export interface ActivateFilters {
  searchTerm: string;
  dateFrom: string;
  dateTo: string;
  statusFilter: StatusFilter;
  projectFilter: string;
}

interface ActivateDataContextValue {
  // Data
  drops: DrListItem[];
  filteredDrops: DrListItem[];
  dashboardStats: DashboardStats;
  projectStats: ProjectStat[];
  dailyStats: DailyStat[];
  pagination: PaginationInfo;

  // Filters
  filters: ActivateFilters;
  setFilters: React.Dispatch<React.SetStateAction<ActivateFilters>>;
  updateFilter: <K extends keyof ActivateFilters>(key: K, value: ActivateFilters[K]) => void;
  clearFilters: () => void;

  // Pagination
  currentPage: number;
  setCurrentPage: (page: number) => void;
  goToNextPage: () => void;
  goToPreviousPage: () => void;

  // Loading states
  isLoading: boolean;
  isInitialLoad: boolean;
  error: string | null;

  // Refresh
  refresh: () => Promise<void>;
  lastRefreshAt: Date | null;

  // Auto-refresh controls
  pauseAutoRefresh: () => void;
  resumeAutoRefresh: () => void;
  isAutoRefreshPaused: boolean;

  // Unique projects for filter dropdown
  projects: string[];
}

const defaultFilters: ActivateFilters = {
  searchTerm: '',
  dateFrom: getTodaySAST(),
  dateTo: getTodaySAST(),
  statusFilter: 'all',
  projectFilter: 'all',
};

const defaultDashboardStats: DashboardStats = {
  totalDrops: 0,
  installed: 0,
  activated: 0,
  notReviewed: 0,
  reviewed: 0,
  totalFeedback: 0,
};

const defaultPagination: PaginationInfo = {
  currentPage: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
  totalCount: 0,
};

// ============================================================================
// CONTEXT
// ============================================================================

const ActivateDataContext = createContext<ActivateDataContextValue | null>(null);

// ============================================================================
// PROVIDER
// ============================================================================

interface ActivateDataProviderProps {
  children: ReactNode;
  /** Auto-refresh interval in ms (default: 30000 = 30s) */
  refreshInterval?: number;
  /** Enable auto-refresh (default: true) */
  autoRefreshEnabled?: boolean;
}

export function ActivateDataProvider({
  children,
  refreshInterval = 30000,
  autoRefreshEnabled = true,
}: ActivateDataProviderProps) {
  // Data state
  const [drops, setDrops] = useState<DrListItem[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>(defaultDashboardStats);
  const [projectStats, setProjectStats] = useState<ProjectStat[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo>(defaultPagination);
  const [activeProjects, setActiveProjects] = useState<string[]>([]);

  // Filter state
  const [filters, setFilters] = useState<ActivateFilters>(defaultFilters);
  const [currentPage, setCurrentPage] = useState(1);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Refresh tracking
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  // Refs for auto-refresh control
  const isAutoRefreshPausedRef = useRef(false);

  // Use activeProjects from API (all active projects for filter dropdown)
  // Falls back to deriving from drops if API doesn't return activeProjects
  const projects = activeProjects.length > 0
    ? activeProjects
    : Array.from(new Set(drops.map((d) => d.project).filter((p): p is string => Boolean(p))));

  // Build API filters from state
  const getApiFilters = useCallback(
    (page?: number): DropsFilters => ({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      project: filters.projectFilter !== 'all' ? filters.projectFilter : undefined,
      status: filters.statusFilter !== 'all' ? filters.statusFilter : undefined,
      page: page ?? currentPage,
    }),
    [filters, currentPage]
  );

  // Fetch data function
  const fetchData = useCallback(
    async (showLoading = false, page?: number) => {
      try {
        if (showLoading) setIsLoading(true);
        setError(null);

        const apiFilters = getApiFilters(page);
        const response = await fetchDrops(apiFilters);

        setDrops(response.data);
        setDashboardStats({
          totalDrops: response.summary.totalDrops,
          installed: response.summary.installed ?? 0,
          activated: response.summary.activated ?? 0,
          notReviewed: response.summary.notReviewed,
          reviewed: response.summary.reviewed,
          totalFeedback: response.summary.totalFeedback,
        });
        setProjectStats(response.projectStats);
        if (response.summary.dailyStats) {
          setDailyStats(response.summary.dailyStats);
        }
        setPagination(response.pagination);
        // Set active projects from API (all active projects for filter dropdown)
        if (response.activeProjects?.length > 0) {
          setActiveProjects(response.activeProjects);
        }
        setLastRefreshAt(new Date());

        if (isInitialLoad) setIsInitialLoad(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch data');
      } finally {
        if (showLoading) setIsLoading(false);
      }
    },
    [getApiFilters, isInitialLoad]
  );

  // Apply client-side search filter
  const filteredDrops = drops.filter((drop) => {
    if (!filters.searchTerm.trim()) return true;
    const term = filters.searchTerm.toLowerCase();
    return (
      drop.dropNumber.toLowerCase().includes(term) ||
      drop.project?.toLowerCase().includes(term)
    );
  });

  // Set up auto-refresh
  const {
    refresh: autoRefresh,
    pause: pauseAutoRefresh,
    resume: resumeAutoRefresh,
  } = useAutoRefresh(() => fetchData(false), {
    interval: refreshInterval,
    enabled: autoRefreshEnabled,
    onRefreshError: (err) => {
      // Silent error handling - don't disrupt user
      console.warn('[ActivateData] Background refresh failed:', err.message);
    },
  });

  // Initial fetch when filters change
  // Note: Empty dateFrom/dateTo means "All" - still needs to fetch
  useEffect(() => {
    // Only fetch if either both dates are set OR both are empty ("All" filter)
    const hasValidDateRange = (filters.dateFrom && filters.dateTo) || (!filters.dateFrom && !filters.dateTo);
    if (hasValidDateRange) {
      setCurrentPage(1);
      fetchData(true, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.dateFrom, filters.dateTo, filters.projectFilter, filters.statusFilter]);

  // Fetch when page changes
  useEffect(() => {
    if (!isInitialLoad) {
      fetchData(true, currentPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // Helper functions
  const updateFilter = useCallback(
    <K extends keyof ActivateFilters>(key: K, value: ActivateFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters({
      ...defaultFilters,
      dateFrom: '',
      dateTo: '',
    });
    setCurrentPage(1);
  }, []);

  const goToNextPage = useCallback(() => {
    if (pagination.hasNextPage) {
      setCurrentPage((prev) => prev + 1);
    }
  }, [pagination.hasNextPage]);

  const goToPreviousPage = useCallback(() => {
    if (pagination.hasPreviousPage) {
      setCurrentPage((prev) => prev - 1);
    }
  }, [pagination.hasPreviousPage]);

  const refresh = useCallback(async () => {
    await fetchData(true, currentPage);
  }, [fetchData, currentPage]);

  const handlePauseAutoRefresh = useCallback(() => {
    isAutoRefreshPausedRef.current = true;
    pauseAutoRefresh();
  }, [pauseAutoRefresh]);

  const handleResumeAutoRefresh = useCallback(() => {
    isAutoRefreshPausedRef.current = false;
    resumeAutoRefresh();
  }, [resumeAutoRefresh]);

  // Context value
  const value: ActivateDataContextValue = {
    // Data
    drops,
    filteredDrops,
    dashboardStats,
    projectStats,
    dailyStats,
    pagination,

    // Filters
    filters,
    setFilters,
    updateFilter,
    clearFilters,

    // Pagination
    currentPage,
    setCurrentPage,
    goToNextPage,
    goToPreviousPage,

    // Loading states
    isLoading,
    isInitialLoad,
    error,

    // Refresh
    refresh,
    lastRefreshAt,

    // Auto-refresh controls
    pauseAutoRefresh: handlePauseAutoRefresh,
    resumeAutoRefresh: handleResumeAutoRefresh,
    isAutoRefreshPaused: isAutoRefreshPausedRef.current,

    // Projects
    projects,
  };

  return (
    <ActivateDataContext.Provider value={value}>
      {children}
    </ActivateDataContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useActivateData(): ActivateDataContextValue {
  const context = useContext(ActivateDataContext);

  if (!context) {
    throw new Error('useActivateData must be used within an ActivateDataProvider');
  }

  return context;
}

// ============================================================================
// EXPORTS
// ============================================================================

export { getTodaySAST, getYesterdaySAST } from '../services/activateDataService';
export type { DrListItem, DashboardStats, ProjectStat, DailyStat } from '../services/activateDataService';
