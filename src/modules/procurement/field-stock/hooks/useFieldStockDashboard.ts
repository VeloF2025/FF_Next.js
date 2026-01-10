/**
 * useFieldStockDashboard Hook
 * Dashboard summary data for field stock
 */

import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/logger';

interface DashboardSummary {
  locations: {
    total: number;
    byType: Record<string, number>;
  };
  items: {
    total: number;
    byCategory: Record<string, number>;
  };
  serials: {
    total: number;
    byStatus: Record<string, number>;
    recentlyInstalled: number;
  };
  consumptions: {
    today: number;
    thisWeek: number;
    unverified: number;
  };
  alerts: {
    lowStock: number;
    pendingReturns: number;
    blockedContractors: number;
  };
}

interface UseFieldStockDashboardReturn {
  summary: DashboardSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const defaultSummary: DashboardSummary = {
  locations: { total: 0, byType: {} },
  items: { total: 0, byCategory: {} },
  serials: { total: 0, byStatus: {}, recentlyInstalled: 0 },
  consumptions: { today: 0, thisWeek: 0, unverified: 0 },
  alerts: { lowStock: 0, pendingReturns: 0, blockedContractors: 0 },
};

export function useFieldStockDashboard(): UseFieldStockDashboardReturn {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/procurement/field-stock/dashboard');
      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to fetch dashboard data');
      }

      setSummary(result.data || defaultSummary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch dashboard data';
      setError(message);
      setSummary(defaultSummary);
      log.error('Failed to fetch dashboard', err, 'useFieldStockDashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchDashboard();
  }, [fetchDashboard]);

  // Fetch on mount
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  return {
    summary,
    loading,
    error,
    refresh,
  };
}
