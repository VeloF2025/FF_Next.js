/**
 * Hook for fetching P&L report data (by BU or by Site)
 */

import { useState, useCallback } from 'react';

export type PnLViewMode = 'bu' | 'site';

interface PnLRow {
  accountName: string;
  accountId: string;
  categoryGroup: string;
  reportingGroup?: string;
  amounts: Record<string, number>;
  total: number;
}

interface PnLData {
  dateRange: { from: string; to: string };
  businessUnits?: string[];
  sites?: Array<{ id: string; siteName: string; projectName: string | null }>;
  rows: PnLRow[];
  sectionTotals?: Record<string, Record<string, number>>;
  grandTotals?: Record<string, number>;
}

export function usePnLReport() {
  const [data, setData] = useState<PnLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (
    viewMode: PnLViewMode,
    fromDate?: string,
    toDate?: string
  ) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const endpoint = viewMode === 'bu'
        ? '/api/sage/reports/pnl-by-bu'
        : '/api/sage/reports/pnl-by-site';

      const res = await fetch(`${endpoint}?${params}`);
      const json = await res.json();

      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message || 'Failed to load report');
      }
    } catch (err) {
      setError('Failed to load P&L report');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fetchReport };
}
