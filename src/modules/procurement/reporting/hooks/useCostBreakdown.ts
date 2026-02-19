/**
 * Hook for fetching cost breakdown matrix data
 */

import { useState, useCallback } from 'react';

interface MatrixRow {
  accountId: string;
  accountName: string;
  category: string;
  amounts: Record<string, number>;
  total: number;
}

interface CostBreakdownData {
  dateRange: { from: string; to: string };
  businessUnits: string[];
  matrix: MatrixRow[];
  columnTotals: Record<string, number>;
  grandTotal: number;
  maxAmount: number;
}

export function useCostBreakdown() {
  const [data, setData] = useState<CostBreakdownData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBreakdown = useCallback(async (
    fromDate?: string,
    toDate?: string
  ) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);

      const res = await fetch(`/api/sage/reports/cost-breakdown?${params}`);
      const json = await res.json();

      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message || 'Failed to load cost breakdown');
      }
    } catch (err) {
      setError('Failed to load cost breakdown');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fetchBreakdown };
}
