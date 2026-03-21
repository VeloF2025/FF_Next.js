/**
 * useProjectRevenueData — React Query hook for the Cost Centre Revenue report.
 * Fetches contract revenue grouped by Cost Centre T1 and Cost Centre
 * from the Shareholder Model via the API.
 */

import { useQuery } from '@tanstack/react-query';

// 🟢 WORKING: Cost Centre Revenue types
export interface CostCentreRevenueItem {
  tier1: string;
  tier2: string;
  revenue: number;
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

async function fetchCostCentreRevenue(): Promise<CostCentreRevenueResponse> {
  const res = await fetch('/api/analytics/reports/project-revenue');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load cost centre revenue data');
  }
  return res.json() as Promise<CostCentreRevenueResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache
export function useProjectRevenueData() {
  return useQuery<CostCentreRevenueResponse, Error>({
    queryKey: ['analytics', 'cost-centre-revenue'],
    queryFn: fetchCostCentreRevenue,
    staleTime: 5 * 60 * 1000,
  });
}
