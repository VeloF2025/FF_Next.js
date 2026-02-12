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
  QAHierarchy,
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
  const [hierarchy, setHierarchy] = useState<QAHierarchy | null>(null);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
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

  // Hierarchy navigation state
  const [selectedZone, setSelectedZone] = useState<number | null | undefined>(undefined);
  const [selectedPon, setSelectedPon] = useState<number | null | undefined>(undefined);
  const [selectedFeatureType, setSelectedFeatureType] = useState<string | undefined>(undefined);

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

  // Fetch hierarchy when project changes
  const fetchHierarchy = useCallback(async (projectId: string) => {
    try {
      setHierarchyLoading(true);
      const result = await qfieldQaApiService.getHierarchy(projectId);
      setHierarchy(result.data);
    } catch (err) {
      setHierarchy(null);
    } finally {
      setHierarchyLoading(false);
    }
  }, []);

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
      // Refresh hierarchy if we have a project selected
      if (filtersRef.current.projectId) {
        fetchHierarchy(filtersRef.current.projectId);
      }
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      throw err;
    }
  }, [fetchValidations, fetchHierarchy]);

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
      const data = result.data as { mode?: string; queued?: number; success?: number; failed?: number; total?: number; message?: string };
      if (data.mode === 'background') {
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

  // Select a hierarchy node — update filters to match
  const selectNode = useCallback((
    zoneNo?: number | null,
    ponNo?: number | null,
    featureType?: string,
  ) => {
    setSelectedZone(zoneNo);
    setSelectedPon(ponNo);
    setSelectedFeatureType(featureType);

    const newFilters: Partial<QAFilters> = {};

    // Zone filter (undefined = not set, null = "Unassigned" zone)
    if (zoneNo !== undefined) {
      newFilters.zoneNo = zoneNo === null ? undefined : zoneNo;
      // For null zones, pass special string marker via the filter
      if (zoneNo === null) {
        // Signal "null zone" — handled by sending zoneNo=null as query param
        newFilters.zoneNo = -1; // sentinel: API handles -1 as NULL filter
      }
    }

    if (ponNo !== undefined) {
      newFilters.ponNo = ponNo === null ? undefined : ponNo;
      if (ponNo === null) {
        newFilters.ponNo = -1;
      }
    }

    if (featureType !== undefined) {
      newFilters.featureType = featureType;
    }

    setFilters(prev => ({
      ...prev,
      ...newFilters,
      // Clear deeper levels when selecting a higher level
      ...(zoneNo !== undefined && ponNo === undefined ? { ponNo: undefined, featureType: undefined } : {}),
      ...(ponNo !== undefined && featureType === undefined ? { featureType: undefined } : {}),
    }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Clear hierarchy selection
  const clearSelection = useCallback(() => {
    setSelectedZone(undefined);
    setSelectedPon(undefined);
    setSelectedFeatureType(undefined);
    setFilters(prev => {
      const { zoneNo, ponNo, featureType, ...rest } = prev;
      return rest;
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Update filters
  const updateFilters = useCallback((newFilters: Partial<QAFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPagination(prev => ({ ...prev, page: 1 }));
  }, []);

  // Clear filters
  const clearFilters = useCallback(() => {
    setFilters({});
    setSelectedZone(undefined);
    setSelectedPon(undefined);
    setSelectedFeatureType(undefined);
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
    hierarchy,
    hierarchyLoading,
    pagination,
    filters,
    loading,
    error,
    lastRefresh,

    // Hierarchy navigation
    selectedZone,
    selectedPon,
    selectedFeatureType,

    // Actions
    refresh: fetchValidations,
    fetchHierarchy,
    selectNode,
    clearSelection,
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
