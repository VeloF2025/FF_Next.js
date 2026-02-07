/**
 * QField QA Hooks
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
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

  // Fetch validations
  const fetchValidations = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true);
      setError(null);

      const [validationsRes, statsRes, projectsRes] = await Promise.all([
        qfieldQaApiService.getValidations({ ...filters, page: pagination.page, pageSize: pagination.pageSize }),
        qfieldQaApiService.getStats(filters.projectId),
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
  }, [filters, pagination.page, pagination.pageSize]);

  // Initial fetch
  useEffect(() => {
    fetchValidations();
  }, [fetchValidations]);

  // Auto-refresh
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
  const triggerValidation = useCallback(async (validationIds: string[]) => {
    try {
      const result = await qfieldQaApiService.triggerValidation({ validationIds });
      await fetchValidations(false);
      return result;
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
