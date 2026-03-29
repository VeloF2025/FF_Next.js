/**
 * WA Monitor Stats Hooks
 * Custom hooks for fetching WA Monitor statistics
 */

import { useQuery, UseQueryResult } from '@tanstack/react-query';

// ============= WA Monitor Stats Types =============

export interface WaMonitorProjectStats {
  project: string;
  total: number;
  complete: number;
  completionRate: number;
  overallTotal?: number;
  overallComplete?: number;
}

export interface WaMonitorCommonFailure {
  step: string;
  count: number;
  percentage: number;
}

export interface WaMonitorAgentPerformance {
  agent: string;
  drops: number;
  completionRate: number;
}

/** Summary statistics returned by /api/wa-monitor-projects-summary */
export interface WaMonitorStats {
  total: number;
  complete: number;
  incomplete: number;
  completionRate: number;
  byProject?: WaMonitorProjectStats[];
  commonFailures?: WaMonitorCommonFailure[];
  agentPerformance?: WaMonitorAgentPerformance[];
  resubmissions?: {
    total: number;
    rate: number;
    firstTimePassRate: number;
  };
  feedbackStats?: {
    sent: number;
    pending: number;
    sendRate: number;
  };
  trends?: {
    weekly: { total: number };
    monthly: { total: number };
  };
}

// ============= Hooks =============

/**
 * Fetch all projects WA Monitor summary
 * Supports optional date range filtering
 * @param startDate - Optional start date (YYYY-MM-DD)
 * @param endDate - Optional end date (YYYY-MM-DD)
 */
export function useWaMonitorSummary(
  startDate?: string,
  endDate?: string
): UseQueryResult<WaMonitorStats> {
  return useQuery<WaMonitorStats>({
    queryKey: ['wa-monitor-summary', startDate, endDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const url = `/api/wa-monitor-projects-summary${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch WA Monitor summary');
      }
      const data = await response.json();
      return data.data as WaMonitorStats;
    },
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    staleTime: 30000, // Consider data stale after 30 seconds
  });
}

/**
 * Fetch stats for a specific project
 */
export function useProjectWaStats(projectName: string | null) {
  return useQuery({
    queryKey: ['wa-monitor-project-stats', projectName],
    queryFn: async () => {
      if (!projectName) return null;

      const response = await fetch(`/api/wa-monitor-project-stats?project=${encodeURIComponent(projectName)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch project WA stats');
      }
      const data = await response.json();
      return data.data;
    },
    enabled: !!projectName, // Only fetch if projectName is provided
    refetchInterval: 30000, // Auto-refresh every 30 seconds
    staleTime: 30000,
  });
}
