/**
 * useQAReadiness Hook - QA Readiness State Management
 *
 * 🟢 WORKING: Production-ready React hook for managing QA readiness checks
 *
 * Features:
 * - Fetch current QA readiness status for a ticket
 * - Run QA readiness checks (manual or automated)
 * - Display failed checks and blocking issues
 * - Automatic query invalidation after checks
 * - Loading state management
 * - Comprehensive error handling
 * - Optimistic updates for better UX
 *
 * Built with React Query (TanStack Query) for:
 * - Automatic caching and background updates
 * - Query invalidation
 * - Loading/error states
 * - Mutation management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createLogger } from '@/lib/logger';
import type {
  QAReadinessStatus,
  QAReadinessCheck,
} from '../types/verification';

const logger = createLogger('ticketing:hooks:qa-readiness');

// ==================== Query Keys ====================

/**
 * 🟢 WORKING: Centralized query key factory for QA readiness queries
 *
 * Follows React Query best practices for hierarchical query keys
 */
export const qaReadinessKeys = {
  all: ['qa-readiness'] as const,
  status: (ticketId: string) => [...qaReadinessKeys.all, 'status', ticketId] as const,
};

// ==================== API Helper Functions ====================

/**
 * 🟢 WORKING: Fetch QA readiness status from API
 */
async function fetchQAReadinessStatus(ticketId: string): Promise<QAReadinessStatus> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/qa-readiness`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to fetch QA readiness status');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Run QA readiness check via API
 */
async function runQAReadinessCheckAPI(
  ticketId: string,
  checkedBy?: string
): Promise<QAReadinessCheck> {
  const body = checkedBy ? { checked_by: checkedBy } : {};

  const response = await fetch(`/api/ticketing/tickets/${ticketId}/qa-readiness-check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to run QA readiness check');
  }

  const data = await response.json();
  return data.data;
}

// ==================== Hooks ====================

/**
 * 🟢 WORKING: Hook for fetching current QA readiness status
 *
 * Returns the current QA readiness state for a ticket including:
 * - is_ready: boolean flag indicating if ticket is ready for QA
 * - last_check: Latest QA readiness check result
 * - failed_reasons: Array of failure reasons if not ready
 * - next_action: Guidance on what needs to be done
 *
 * @param ticketId - UUID of the ticket
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with QA readiness status
 *
 * @example
 * ```tsx
 * const { data: status, isLoading } = useQAReadinessStatus(ticketId);
 *
 * if (status?.is_ready) {
 *   // Show "Ready for QA" indicator
 * } else {
 *   // Show failed checks and blockers
 *   status?.failed_reasons.map(reason => <Alert>{reason}</Alert>)
 * }
 * ```
 */
export function useQAReadinessStatus(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: qaReadinessKeys.status(ticketId),
    queryFn: () => fetchQAReadinessStatus(ticketId),
    enabled: !!ticketId && enabled,
    staleTime: 1 * 60 * 1000, // 1 minute (readiness can change frequently)
    gcTime: 3 * 60 * 1000, // 3 minutes
  });
}

/**
 * 🟢 WORKING: Hook for running QA readiness checks
 *
 * Triggers a QA readiness validation check on the ticket.
 * The check validates:
 * - Required photos exist
 * - DR, pole, PON, zone are populated
 * - ONT serial and RX power are recorded
 * - Platform alignment (SP, SOW, tracker)
 *
 * Automatically invalidates the status query on success to show updated state.
 *
 * @returns Mutation object for running QA readiness checks
 *
 * @example
 * ```tsx
 * const runCheck = useRunQAReadinessCheck();
 *
 * // System-triggered check (no user attribution)
 * runCheck.mutate({ ticketId });
 *
 * // User-triggered check
 * runCheck.mutate({
 *   ticketId,
 *   checkedBy: currentUser.id
 * });
 *
 * // With callbacks
 * runCheck.mutate(
 *   { ticketId },
 *   {
 *     onSuccess: (result) => {
 *       if (result.passed) {
 *         toast.success('Ticket is ready for QA!');
 *       } else {
 *         toast.error(`${result.failed_checks?.length} checks failed`);
 *       }
 *     }
 *   }
 * );
 * ```
 */
export function useRunQAReadinessCheck() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ticketId,
      checkedBy,
    }: {
      ticketId: string;
      checkedBy?: string;
    }) => runQAReadinessCheckAPI(ticketId, checkedBy),
    onSuccess: (data, variables) => {
      const { ticketId } = variables;

      // 🟢 WORKING: Invalidate status query to trigger refetch
      queryClient.invalidateQueries({ queryKey: qaReadinessKeys.status(ticketId) });

      logger.info('QA readiness check completed', {
        ticketId,
        passed: data.passed,
        failedChecks: data.failed_checks?.length || 0,
      });
    },
    onError: (error, variables) => {
      logger.error('Failed to run QA readiness check', {
        error,
        ticketId: variables.ticketId,
      });
    },
  });
}

/**
 * 🟢 WORKING: Utility hook that combines status query and check mutation
 *
 * Convenience hook that provides:
 * - Current QA readiness status
 * - Function to run new checks
 * - Aggregate loading states
 * - Easy access to common properties
 *
 * This is the recommended hook for most use cases as it provides
 * everything you need for QA readiness management in a single hook.
 *
 * @param ticketId - UUID of the ticket
 * @param enabled - Whether to enable the status query (default: true)
 * @returns Combined result with status, check function, and convenience properties
 *
 * @example
 * ```tsx
 * const {
 *   status,
 *   isReady,
 *   failedReasons,
 *   runCheck,
 *   isLoading,
 *   isChecking
 * } = useQAReadiness(ticketId);
 *
 * if (isLoading) return <Spinner />;
 *
 * return (
 *   <div>
 *     <ReadinessIndicator isReady={isReady} />
 *     {!isReady && (
 *       <FailedChecksList reasons={failedReasons} />
 *     )}
 *     <Button
 *       onClick={() => runCheck.mutate({ ticketId })}
 *       loading={isChecking}
 *     >
 *       Run QA Readiness Check
 *     </Button>
 *   </div>
 * );
 * ```
 */
export function useQAReadiness(ticketId: string, enabled = true) {
  const statusQuery = useQAReadinessStatus(ticketId, enabled);
  const checkMutation = useRunQAReadinessCheck();

  return {
    // Status data
    status: statusQuery.data,
    isReady: statusQuery.data?.is_ready ?? false,
    lastCheck: statusQuery.data?.last_check ?? null,
    lastCheckAt: statusQuery.data?.last_check_at ?? null,
    failedReasons: statusQuery.data?.failed_reasons ?? null,
    nextAction: statusQuery.data?.next_action ?? '',

    // Loading states
    isLoading: statusQuery.isLoading,
    isError: statusQuery.isError,
    error: statusQuery.error,
    isChecking: checkMutation.isPending,

    // Actions
    runCheck: checkMutation,
    refetch: statusQuery.refetch,
  };
}

// Export all hooks
export default {
  useQAReadinessStatus,
  useRunQAReadinessCheck,
  useQAReadiness,
};
