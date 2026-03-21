/**
 * useProjectDetailData — React Query hook for the Project Detail report.
 *
 * Fetches per-project COS sub-categories and financial summary from the
 * live Data + FT_Invoice worksheets via the project-detail API route.
 *
 * Stale time: 5 minutes. Query key includes project name so React Query
 * automatically refetches when the project param changes.
 */

import { useQuery } from '@tanstack/react-query';

/** Monthly values — overall total plus per-month breakdown */
export interface MonthlyValues {
  /** Sum across all months */
  total: number;
  /** Per-month amounts keyed by "MMM-YY" label (e.g. "Mar-25") */
  monthly: Record<string, number>;
}

/** Full response payload from GET /api/analytics/reports/project-detail */
export interface ProjectDetailData {
  /** Selected project name */
  project: string;
  /** All available project names for the slicer dropdown */
  availableProjects: string[];
  /** Sorted month labels ("MMM-YY") present in the data */
  months: string[];
  /** COS sub-category breakdown — keyed by category name */
  cosActual: Record<string, MonthlyValues>;
  /** Aggregated totals across all COS sub-categories */
  cosTotal: MonthlyValues;
  /** Financial summary metrics */
  summary: {
    /** Number of invoice rows per month (activation count) */
    activations: MonthlyValues;
    /** Total invoice debit amount per month */
    revenue: MonthlyValues;
    /** Revenue minus COS per month */
    gross: MonthlyValues;
    /** Net (equals gross at this data level) */
    net: MonthlyValues;
  };
}

/** API response envelope */
export interface ProjectDetailResponse {
  success: boolean;
  data: ProjectDetailData;
}

/** Error response body shape */
interface ApiErrorBody {
  error?: { message?: string };
}

async function fetchProjectDetail(project: string): Promise<ProjectDetailResponse> {
  const res = await fetch(
    `/api/analytics/reports/project-detail?project=${encodeURIComponent(project)}`
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message ?? 'Failed to load Project Detail data');
  }
  return res.json() as Promise<ProjectDetailResponse>;
}

// 🟢 WORKING: React Query hook with 5-minute cache, keyed by project name
export function useProjectDetailData(project: string) {
  return useQuery<ProjectDetailResponse, Error>({
    queryKey: ['analytics', 'project-detail', project],
    queryFn: () => fetchProjectDetail(project),
    staleTime: 5 * 60 * 1000,
  });
}
