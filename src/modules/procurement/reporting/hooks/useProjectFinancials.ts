/**
 * Hook for fetching project financial summary data
 * (FF Budget vs Committed POs vs Sage Actuals vs Variance)
 */

import { useState, useCallback } from 'react';

interface ProjectSummary {
  budget: number;
  committed: number;
  sageActuals: number;
  invoiced: number;
  outstanding: number;
  variance: number;
  variancePercent: number;
  budgetStatus: string;
}

interface POSummary {
  total: number;
  approved: number;
  sent: number;
  paid: number;
  totalAmount: number;
}

interface SageBreakdownRow {
  category: string;
  debit: number;
  credit: number;
  netAmount: number;
  transactionCount: number;
}

interface BUBreakdownRow {
  businessUnit: string;
  debit: number;
  credit: number;
  netAmount: number;
  transactionCount: number;
}

interface MonthlyTrendRow {
  month: string;
  debit: number;
  credit: number;
  netAmount: number;
}

export interface ProjectFinancialsData {
  project: { id: string; name: string; status: string };
  summary: ProjectSummary;
  purchaseOrders: POSummary;
  sageBreakdown: SageBreakdownRow[];
  byBusinessUnit: BUBreakdownRow[];
  monthlyTrend: MonthlyTrendRow[];
}

export function useProjectFinancials() {
  const [data, setData] = useState<ProjectFinancialsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFinancials = useCallback(async (projectId: string) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/sage/reports/project-financials?projectId=${projectId}`);
      const json = await res.json();

      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error?.message || 'Failed to load project financials');
      }
    } catch {
      setError('Failed to load project financials');
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, loading, error, fetchFinancials };
}
