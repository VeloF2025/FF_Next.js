/** useSerialReconciliation — auto-fetches the read-only drift summary on mount. */
import { useState, useCallback, useEffect } from 'react';
import { log } from '@/lib/logger';
import type { ReconciliationSummary } from '@/types/field-stock';

interface UseSerialReconciliationReturn {
  summary: ReconciliationSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSerialReconciliation(): UseSerialReconciliationReturn {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/procurement/field-stock/serial-reconciliation', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      if (!result.success) throw new Error(result.error?.message || 'Failed to load reconciliation');
      setSummary(result.data as ReconciliationSummary);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load reconciliation';
      setError(message);
      log.error('Failed to fetch serial reconciliation', { error: err }, 'useSerialReconciliation');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => { await fetchData(); }, [fetchData]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  return { summary, loading, error, refresh };
}
