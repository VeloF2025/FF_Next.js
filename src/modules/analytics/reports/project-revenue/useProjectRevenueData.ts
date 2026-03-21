/**
 * useProjectRevenueData — React Query hook for the Project Revenue report.
 * Fetches projected FC Activation values per project from SharePoint via the API.
 */

import { useQuery } from '@tanstack/react-query';

export interface ProjectRevenuePoint {
  project: string;
  fcActivation: number;
}

export interface ProjectRevenueResponse {
  success: boolean;
  data: ProjectRevenuePoint[];
  meta: {
    generatedAt: string;
    projectCount: number;
  };
}

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function fetchProjectRevenue(): Promise<ProjectRevenueResponse> {
  const res = await fetch('/api/analytics/reports/project-revenue');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load project revenue data');
  }
  return res.json() as Promise<ProjectRevenueResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache
export function useProjectRevenueData() {
  return useQuery<ProjectRevenueResponse, Error>({
    queryKey: ['analytics', 'project-revenue'],
    queryFn: fetchProjectRevenue,
    staleTime: 5 * 60 * 1000,
  });
}
