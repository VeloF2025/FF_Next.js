/**
 * useProjectFinData — React Query hook for the Project COS/Revenue/Net report.
 * Fetches structured financial data from the "Project_Fin" SharePoint worksheet.
 * Stale time: 5 minutes.
 */

import { useQuery } from '@tanstack/react-query';

/** Per-project monthly values — keyed by "MMM-YY" month labels + "actual" */
export interface ProjectMonthlyData {
  actual: number;
  [monthLabel: string]: number;
}

/** Section data: projectName → monthly values */
export type SectionData = Record<string, ProjectMonthlyData>;

/** Totals row for one section */
export interface SectionTotals {
  actual: number;
  [monthLabel: string]: number;
}

/** Full response payload from the API */
export interface ProjectFinData {
  months: string[];
  projects: string[];
  cos: SectionData;
  revenue: SectionData;
  net: SectionData;
  totals: {
    cos: SectionTotals;
    revenue: SectionTotals;
    net: SectionTotals;
  };
}

export interface ProjectFinResponse {
  success: boolean;
  data: ProjectFinData;
}

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function fetchProjectFin(): Promise<ProjectFinResponse> {
  const res = await fetch('/api/analytics/reports/project-fin');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load Project Fin data');
  }
  return res.json() as Promise<ProjectFinResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache
export function useProjectFinData() {
  return useQuery<ProjectFinResponse, Error>({
    queryKey: ['analytics', 'project-fin'],
    queryFn: fetchProjectFin,
    staleTime: 5 * 60 * 1000,
  });
}
