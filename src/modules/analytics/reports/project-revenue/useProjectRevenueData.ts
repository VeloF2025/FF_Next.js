/**
 * useProjectRevenueData — React Query hook for the Cost Centre Profitability report.
 * Fetches COS vs Revenue per project from the Shareholder Model via the API.
 */

import { useQuery } from '@tanstack/react-query';

// 🟢 WORKING: Cost Centre Profitability types — COS vs Revenue per project
export interface ProjectProfitabilityRow {
  project: string;
  revenue: number;
  cos: number;
  grossProfit: number;
  margin: number;
}

export interface CostCentreRevenueItem {
  tier1: string;
  revenue: number;
  cos: number;
  grossProfit: number;
  margin: number;
  children: ProjectProfitabilityRow[];
}

export interface CostCentreRevenueResponse {
  success: boolean;
  data: CostCentreRevenueItem[];
  meta: {
    generatedAt: string;
    itemCount: number;
    sources: string[];
  };
}

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function fetchCostCentreProfitability(): Promise<CostCentreRevenueResponse> {
  const res = await fetch('/api/analytics/reports/project-revenue');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load cost centre profitability data');
  }
  return res.json() as Promise<CostCentreRevenueResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache
export function useProjectRevenueData() {
  return useQuery<CostCentreRevenueResponse, Error>({
    queryKey: ['analytics', 'cost-centre-profitability'],
    queryFn: fetchCostCentreProfitability,
    staleTime: 5 * 60 * 1000,
  });
}
