/**
 * QField QA Hooks
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { qfieldQaApiService } from '../services/qfieldQaApiService';
import type {
  PhotoValidation,
  QAStats,
  QAProject,
  QAFilters,
  ActionRequest,
  ActionType,
  Priority,
} from '../types';

interface UseQFieldQaOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function useQFieldQa(options: UseQFieldQaOptions = {}) {
  const { autoRefresh = false, refreshInterval = 30000 } = options;

  const [validations, setValidations] = useState<PhotoValidation[]>([]);
  const [stats, setStats] = useState<QAStats | null>(null);
  const [projects, setProjects] = useState<QAProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filters, setFilters] = useState<QAFilters>({});
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 0,
  });

  // Use refs to track current values without causing re-renders
  const filtersRef = useRef(filters);
  const paginationRef = useRef(pagination);

  // Keep refs in sync
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  useEffect(() => {
    paginationRef.current = pagination;
  }, [pagination]);

  // Stable fetch function using refs to access latest values
  const fetchValidations = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      const [validationsRes, statsRes, projectsRes] = await Promise.all([
        qfieldQaApiService.getValidations({
          ...filtersRef.current,
          page: paginationRef.current.page,
          pageSize: paginationRef.current.pageSize
        }),
        qfieldQaApiService.getStats(filtersRef.current.projectId),
        qfieldQaApiService.getProjects(),
      ]);

      setValidations(validationsRes.data);
      setPagination(validationsRes.pagination);
      setStats(statsRes.data);
      setProjects(projectsRes.data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []); // No dependencies - stable reference

  // Fetch when filters or pagination change
  useEffect(() => {
    fetchValidations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, pagination.page, pagination.pageSize]);

  // Auto-refresh with stable interval
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchValidations(false);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchValidations]);

  // Execute action
  const executeAction = useCallback(async (
    action: ActionType,
    validationIds: string[],
    options?: {
      notes?: string;
      assignee?: string;
      dueDate?: string;
      priority?: Priority;
      escalationReason?: string;
    }
  ) => {
    try {
      const request: ActionRequest = {
        action,
        validationIds,
        ...options,
      };
      const result = await qfieldQaApiService.executeAction(request);
      await fetchValidations(false);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      throw err;
    }
  }, [fetchValidations]);

  // Trigger validation
  const triggerValidation = useCallback(async (validationIds: string[]): Promise<{
    mode?: 'background' | 'sync';
    queued?: number;
    success?: number;
    failed?: number;
    total: number;
    message?: string;
  }> => {
    try {
      const result = await qfieldQaApiService.triggerValidation({ validationIds });
      // Refresh data after a short delay for background mode
      const data = result.data as { mode?: string; queued?: number; success?: number; failed?: number; total?: number; message?: string };
      if (data.mode === 'background') {
        // For background processing, refresh after a delay to show "validating" status
        setTimeout(() => fetchValidations(false), 1000);
      } else {
        await fetchValidations(false);
      }
      return {
        mode: data.mode as 'background' | 'sync' | undefined,
        queued: data.queued,
        success: data.success,
        failed: data.failed,
        total: data.total || validationIds.length,
        message: data.message,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed');
      throw err;
    }
  }, [fetchValidations]);

  // Assign photos
  const assignPhotos = useCallback(async (
    validationIds: string[],
    assignee: string,
    options?: { dueDate?: string; priority?: string; notes?: string }
  ) => {
    try {
      const result = await qfieldQaApiService.assignPhotos({
        validationIds,
        assignee,
        ...options,
      });
      await fetchValidations(false);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
      throw err;
    }
  }, [fetchValidations]);

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<QAFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Clear filters
  const clearFilters = useCallback(() => {
    setFilters({});
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Set page
  const setPage = useCallback((page: number) => {
    setPagination(prev => ({ ...prev, page }));
  }, []);

  return {
    // Data
    validations,
    stats,
    projects,
    pagination,
    filters,
    loading,
    error,
    lastRefresh,

    // Actions
    refresh: fetchValidations,
    executeAction,
    triggerValidation,
    assignPhotos,
    updateFilters,
    clearFilters,
    setPage,
  };
}

export function useQFieldQaStats(projectId?: string) {
  const [stats, setStats] = useState<QAStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      const result = await qfieldQaApiService.getStats(projectId);
      setStats(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refresh: fetchStats };
}

export function useMyQueue(userId: string) {
  const [assignments, setAssignments] = useState<PhotoValidation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMyQueue = useCallback(async () => {
    try {
      setLoading(true);
      const result = await qfieldQaApiService.getValidations({
        assignedTo: userId,
        workflowStatus: 'in_review',
      });
      setAssignments(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch queue');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) fetchMyQueue();
  }, [userId, fetchMyQueue]);

  return { assignments, loading, error, refresh: fetchMyQueue };
}
