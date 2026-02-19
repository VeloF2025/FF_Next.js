/**
 * useFaultReports Hook
 * Manages fault report CRUD operations and analytics fetching
 */

import { useState, useCallback } from 'react';
import { log } from '@/lib/logger';
import type {
  FaultReportListItem,
  FaultAnalytics,
  FaultReportFilter,
} from '@/types/procurement/fault.types';

interface UseFaultReportsReturn {
  faultReports: FaultReportListItem[];
  analytics: FaultAnalytics | null;
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  fetchFaultReports: (filter?: FaultReportFilter, page?: number) => Promise<void>;
  createFaultReport: (data: Record<string, unknown>) => Promise<boolean>;
  updateFaultReport: (id: string, data: Record<string, unknown>) => Promise<boolean>;
  fetchAnalytics: () => Promise<void>;
}

function buildQueryParams(filter?: FaultReportFilter, page?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (page) params.set('page', String(page));
  params.set('limit', '50');
  if (filter?.faultType) params.set('fault_type', filter.faultType);
  if (filter?.severity) params.set('severity', filter.severity);
  if (filter?.resolutionStatus) params.set('resolution_status', filter.resolutionStatus);
  if (filter?.projectId) params.set('project_id', filter.projectId);
  return params;
}

export function useFaultReports(): UseFaultReportsReturn {
  const [faultReports, setFaultReports] = useState<FaultReportListItem[]>([]);
  const [analytics, setAnalytics] = useState<FaultAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);

  const fetchFaultReports = useCallback(async (
    filter?: FaultReportFilter,
    pageNum: number = 1,
  ) => {
    setLoading(true);
    setError(null);

    try {
      const params = buildQueryParams(filter, pageNum);
      const response = await fetch(`/api/procurement/fault-reports/?${params.toString()}`);
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch fault reports');
      }

      setFaultReports(result.data ?? []);
      setTotal(result.pagination?.total ?? 0);
      setPage(pageNum);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch fault reports';
      setError(message);
      log.error('Failed to fetch fault reports', { data: err }, 'useFaultReports');
    } finally {
      setLoading(false);
    }
  }, []);

  const createFaultReport = useCallback(async (
    data: Record<string, unknown>,
  ): Promise<boolean> => {
    try {
      const response = await fetch('/api/procurement/fault-reports/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to create fault report');
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create fault report';
      setError(message);
      log.error('Failed to create fault report', { data: err }, 'useFaultReports');
      return false;
    }
  }, []);

  const updateFaultReport = useCallback(async (
    id: string,
    data: Record<string, unknown>,
  ): Promise<boolean> => {
    try {
      const response = await fetch(`/api/procurement/fault-reports/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to update fault report');
      }

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update fault report';
      setError(message);
      log.error('Failed to update fault report', { data: err }, 'useFaultReports');
      return false;
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/procurement/fault-reports/analytics');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch fault analytics');
      }

      setAnalytics(result.data ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch fault analytics';
      setError(message);
      log.error('Failed to fetch fault analytics', { data: err }, 'useFaultReports');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    faultReports,
    analytics,
    loading,
    error,
    total,
    page,
    fetchFaultReports,
    createFaultReport,
    updateFaultReport,
    fetchAnalytics,
  };
}
