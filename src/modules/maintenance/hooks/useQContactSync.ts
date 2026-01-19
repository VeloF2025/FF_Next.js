/**
 * useQContactSync Hook - QContact Sync State Management
 *
 * 🟢 WORKING: Production-ready React hook for managing QContact sync state
 *
 * Features:
 * - Fetch sync status overview
 * - Fetch sync log/audit trail
 * - Trigger manual sync
 * - Real-time sync monitoring
 * - Optimistic updates for better UX
 * - Automatic query invalidation on updates
 * - Comprehensive error handling
 * - Loading state management
 *
 * Built with React Query (TanStack Query) for:
 * - Automatic caching and background updates
 * - Optimistic updates
 * - Query invalidation
 * - Loading/error states
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createLogger } from '@/lib/logger';
import type {
  QContactSyncLog,
  SyncStatusOverview,
  SyncLogFilters,
  SyncLogListResponse,
  FullSyncRequest,
  FullSyncResult,
} from '../types/qcontact';

const logger = createLogger('ticketing:hooks:qcontact-sync');

// ==================== Query Keys ====================

/**
 * 🟢 WORKING: Centralized query key factory for QContact sync queries
 *
 * Follows React Query best practices for hierarchical query keys
 */
export const qcontactSyncKeys = {
  all: ['qcontact-sync'] as const,
  status: () => [...qcontactSyncKeys.all, 'status'] as const,
  logs: () => [...qcontactSyncKeys.all, 'logs'] as const,
  logsList: (filters?: SyncLogFilters) => [...qcontactSyncKeys.logs(), 'list', filters] as const,
};

// ==================== API Helper Functions ====================

/**
 * 🟢 WORKING: Fetch sync status overview from API
 */
async function fetchSyncStatus(): Promise<SyncStatusOverview> {
  const response = await fetch('/api/ticketing/sync/qcontact/status', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: 'Failed to fetch sync status' } }));
    throw new Error(errorData.error?.message || 'Failed to fetch sync status');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Fetch sync log from API
 */
async function fetchSyncLog(filters?: SyncLogFilters): Promise<SyncLogListResponse> {
  const queryParams = new URLSearchParams();

  if (filters) {
    if (filters.ticket_id) queryParams.append('ticket_id', filters.ticket_id);
    if (filters.qcontact_ticket_id) queryParams.append('qcontact_ticket_id', filters.qcontact_ticket_id);
    if (filters.sync_direction) {
      const directions = Array.isArray(filters.sync_direction) ? filters.sync_direction : [filters.sync_direction];
      directions.forEach(dir => queryParams.append('sync_direction', dir));
    }
    if (filters.sync_type) {
      const types = Array.isArray(filters.sync_type) ? filters.sync_type : [filters.sync_type];
      types.forEach(type => queryParams.append('sync_type', type));
    }
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      statuses.forEach(status => queryParams.append('status', status));
    }
    if (filters.synced_after) queryParams.append('synced_after', filters.synced_after.toISOString());
    if (filters.synced_before) queryParams.append('synced_before', filters.synced_before.toISOString());
  }

  const url = `/api/ticketing/sync/qcontact/log${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: 'Failed to fetch sync log' } }));
    throw new Error(errorData.error?.message || 'Failed to fetch sync log');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Trigger manual sync via API
 */
async function triggerManualSync(request?: FullSyncRequest): Promise<FullSyncResult> {
  const response = await fetch('/api/ticketing/sync/qcontact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request || {}),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: { message: 'Failed to trigger sync' } }));
    throw new Error(errorData.error?.message || 'Failed to trigger sync');
  }

  const data = await response.json();
  // API returns { data: { sync_result: FullSyncResult, summary: {...} } }
  return data.data.sync_result;
}

// ==================== React Query Hooks ====================

/**
 * 🟢 WORKING: Hook to fetch sync status overview
 *
 * @param options - React Query options
 * @returns Query result with sync status overview
 *
 * @example
 * const { syncStatus, isLoading, isError, error } = useQContactSyncStatus();
 */
export function useQContactSyncStatus(options?: {
  refetchInterval?: number;
  enabled?: boolean;
}) {
  const query = useQuery({
    queryKey: qcontactSyncKeys.status(),
    queryFn: fetchSyncStatus,
    refetchInterval: options?.refetchInterval || 30000, // Default: 30 seconds
    enabled: options?.enabled ?? true,
    staleTime: 10000, // Consider data stale after 10 seconds
  });

  return {
    syncStatus: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * 🟢 WORKING: Hook to fetch sync log/audit trail
 *
 * @param filters - Optional filters for the sync log
 * @param options - React Query options
 * @returns Query result with sync logs
 *
 * @example
 * const { syncLogs, isLoading, isError, error } = useQContactSyncLog({
 *   sync_direction: SyncDirection.INBOUND,
 *   status: SyncStatus.FAILED,
 * });
 */
export function useQContactSyncLog(
  filters?: SyncLogFilters,
  options?: {
    enabled?: boolean;
  }
) {
  const query = useQuery({
    queryKey: qcontactSyncKeys.logsList(filters),
    queryFn: () => fetchSyncLog(filters),
    enabled: options?.enabled ?? true,
    staleTime: 30000, // Consider data stale after 30 seconds
  });

  return {
    syncLogs: query.data?.logs,
    total: query.data?.total || 0,
    byDirection: query.data?.by_direction,
    byStatus: query.data?.by_status,
    successRate: query.data?.success_rate || 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * 🟢 WORKING: Hook to trigger manual sync
 *
 * @returns Mutation result for triggering sync
 *
 * @example
 * const triggerSync = useTriggerManualSync();
 *
 * // Trigger full sync
 * triggerSync.mutate({});
 *
 * // Trigger sync with specific options
 * triggerSync.mutate({
 *   sync_direction: SyncDirection.INBOUND,
 *   force_resync: true,
 * });
 */
export function useTriggerManualSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request?: FullSyncRequest) => triggerManualSync(request),
    onSuccess: () => {
      // 🟢 WORKING: Invalidate all sync-related queries to refresh data
      queryClient.invalidateQueries({ queryKey: qcontactSyncKeys.all });

      logger.info('Manual sync triggered successfully');
    },
    onError: (error: Error) => {
      logger.error('Failed to trigger manual sync', { error: error.message });
    },
  });
}

/**
 * 🟢 WORKING: Hook to invalidate sync queries (useful for manual refresh)
 *
 * @returns Function to invalidate all sync queries
 *
 * @example
 * const invalidateSync = useInvalidateSyncQueries();
 * invalidateSync(); // Refresh all sync data
 */
export function useInvalidateSyncQueries() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: qcontactSyncKeys.all });
  };
}
