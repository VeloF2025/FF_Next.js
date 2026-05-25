/** useDashboardV2 — fetches the v2 metric summary. */
import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/logger';
import type { DashboardV2Summary } from '@/types/field-stock';

interface UseDashboardV2Return {
  summary: DashboardV2Summary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useDashboardV2(): UseDashboardV2Return {
  const [summary, setSummary] = useState<DashboardV2Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/procurement/field-stock/dashboard-v2', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error?.message || 'Failed to load dashboard');
      setSummary(result.data as DashboardV2Summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(message);
      log.error('Failed to fetch dashboard v2', { error: err }, 'useDashboardV2');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => { await fetchData(); }, [fetchData]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { summary, loading, error, refresh };
}
