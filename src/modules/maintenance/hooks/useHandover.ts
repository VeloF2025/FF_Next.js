/**
 * useHandover Hook - Handover State Management
 *
 * 🟢 WORKING: Production-ready React hook for managing ticket handovers
 *
 * Features:
 * - Validate handover gates before handover
 * - Create handover snapshots
 * - Get handover history for tickets
 * - Get specific handover by ID
 * - Automatic query invalidation
 * - Loading state management
 * - Comprehensive error handling
 *
 * Built with React Query (TanStack Query) for:
 * - Automatic caching and background updates
 * - Query invalidation
 * - Loading/error states
 * - Mutation management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  HandoverGateValidation,
  HandoverSnapshot,
  CreateHandoverSnapshotPayload,
  TicketHandoverHistory,
  HandoverType,
} from '../types/handover';

// ==================== Query Keys ====================

/**
 * 🟢 WORKING: Centralized query key factory for handover queries
 *
 * Follows React Query best practices for hierarchical query keys
 */
export const handoverKeys = {
  all: ['handovers'] as const,
  validation: (ticketId: string, handoverType: HandoverType) =>
    [...handoverKeys.all, 'validation', ticketId, handoverType] as const,
  history: (ticketId: string) =>
    [...handoverKeys.all, 'history', ticketId] as const,
  detail: (handoverId: string) =>
    [...handoverKeys.all, 'detail', handoverId] as const,
};

// ==================== API Helper Functions ====================

/**
 * 🟢 WORKING: Validate handover gates from API
 */
async function validateHandoverGateAPI(
  ticketId: string,
  handoverType: HandoverType
): Promise<HandoverGateValidation> {
  const response = await fetch(
    `/api/ticketing/tickets/${ticketId}/handover/validate?type=${handoverType}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to validate handover gates');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Create handover snapshot via API
 */
async function createHandoverSnapshotAPI(
  payload: CreateHandoverSnapshotPayload
): Promise<HandoverSnapshot> {
  const response = await fetch(`/api/ticketing/tickets/${payload.ticket_id}/handover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to create handover snapshot');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Get handover history from API
 */
async function getHandoverHistoryAPI(ticketId: string): Promise<TicketHandoverHistory> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/handover-history`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to get handover history');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Get handover by ID from API
 */
async function getHandoverByIdAPI(handoverId: string): Promise<HandoverSnapshot> {
  const response = await fetch(`/api/ticketing/handovers/${handoverId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to get handover');
  }

  const data = await response.json();
  return data.data;
}

// ==================== Hooks ====================

/**
 * 🟢 WORKING: Hook for validating handover gates
 *
 * Returns gate validation result including:
 * - can_handover: boolean flag indicating if handover can proceed
 * - blocking_issues: Critical issues preventing handover
 * - warnings: Non-blocking warnings
 * - gates_passed: List of gates that passed validation
 * - gates_failed: List of gates that failed validation
 *
 * @param ticketId - UUID of the ticket
 * @param handoverType - Type of handover to validate
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with gate validation
 *
 * @example
 * ```tsx
 * const { data: validation, isLoading } = useHandoverGateValidation(
 *   ticketId,
 *   HandoverType.QA_TO_MAINTENANCE
 * );
 *
 * if (validation?.can_handover) {
 *   // Show handover button
 * } else {
 *   // Show blocking issues
 *   validation?.blocking_issues.map(issue => <Alert>{issue.message}</Alert>)
 * }
 * ```
 */
export function useHandoverGateValidation(
  ticketId: string,
  handoverType: HandoverType,
  enabled = true
) {
  return useQuery({
    queryKey: handoverKeys.validation(ticketId, handoverType),
    queryFn: () => validateHandoverGateAPI(ticketId, handoverType),
    enabled: !!ticketId && !!handoverType && enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes (gates can change as work progresses)
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * 🟢 WORKING: Hook for creating handover snapshots
 *
 * Triggers creation of an immutable handover snapshot.
 * The snapshot includes:
 * - Full ticket state at time of handover
 * - All evidence links (photos/documents)
 * - All QA decisions (approvals/rejections/risks)
 * - Ownership transfer details
 *
 * Automatically invalidates handover history query on success.
 *
 * @returns Mutation object for creating handovers
 *
 * @example
 * ```tsx
 * const createHandover = useCreateHandover();
 *
 * createHandover.mutate(
 *   {
 *     ticket_id: ticketId,
 *     handover_type: HandoverType.QA_TO_MAINTENANCE,
 *     from_owner_type: OwnerType.QA,
 *     from_owner_id: qaUserId,
 *     to_owner_type: OwnerType.MAINTENANCE,
 *     to_owner_id: maintUserId,
 *     handover_by: currentUser.id,
 *   },
 *   {
 *     onSuccess: (snapshot) => {
 *       toast.success('Handover completed successfully');
 *       router.push(`/ticketing/handovers/${snapshot.id}`);
 *     },
 *     onError: (error) => {
 *       toast.error(error.message);
 *     }
 *   }
 * );
 * ```
 */
export function useCreateHandover() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateHandoverSnapshotPayload) =>
      createHandoverSnapshotAPI(payload),
    onSuccess: (data, variables) => {
      const { ticket_id } = variables;

      // 🟢 WORKING: Invalidate handover history to trigger refetch
      queryClient.invalidateQueries({ queryKey: handoverKeys.history(ticket_id) });

      // Also invalidate validation queries as handover state has changed
      queryClient.invalidateQueries({ queryKey: handoverKeys.all });
    },
  });
}

/**
 * 🟢 WORKING: Hook for fetching handover history
 *
 * Returns complete handover history for a ticket including:
 * - All handover snapshots (chronological order)
 * - Current owner information
 * - Total handover count
 *
 * @param ticketId - UUID of the ticket
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with handover history
 *
 * @example
 * ```tsx
 * const { data: history, isLoading } = useHandoverHistory(ticketId);
 *
 * if (history) {
 *   return (
 *     <Timeline>
 *       {history.handovers.map(handover => (
 *         <TimelineEntry key={handover.id} handover={handover} />
 *       ))}
 *     </Timeline>
 *   );
 * }
 * ```
 */
export function useHandoverHistory(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: handoverKeys.history(ticketId),
    queryFn: () => getHandoverHistoryAPI(ticketId),
    enabled: !!ticketId && enabled,
    staleTime: 5 * 60 * 1000, // 5 minutes (history is fairly static)
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * 🟢 WORKING: Hook for fetching specific handover by ID
 *
 * Returns a single handover snapshot with complete details.
 *
 * @param handoverId - UUID of the handover snapshot
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with handover snapshot
 *
 * @example
 * ```tsx
 * const { data: handover, isLoading } = useHandover(handoverId);
 *
 * if (handover) {
 *   return <HandoverSnapshot snapshot={handover} />;
 * }
 * ```
 */
export function useHandover(handoverId: string, enabled = true) {
  return useQuery({
    queryKey: handoverKeys.detail(handoverId),
    queryFn: () => getHandoverByIdAPI(handoverId),
    enabled: !!handoverId && enabled,
    staleTime: 30 * 60 * 1000, // 30 minutes (snapshots are immutable)
    gcTime: 60 * 60 * 1000, // 1 hour
  });
}

/**
 * 🟢 WORKING: Utility hook that combines validation and creation
 *
 * Convenience hook that provides:
 * - Gate validation results
 * - Function to create handover
 * - Aggregate loading states
 * - Easy access to common properties
 *
 * This is the recommended hook for handover wizard/form components.
 *
 * @param ticketId - UUID of the ticket
 * @param handoverType - Type of handover
 * @param enabled - Whether to enable validation query (default: true)
 * @returns Combined result with validation, creation function, and convenience properties
 *
 * @example
 * ```tsx
 * const {
 *   validation,
 *   canHandover,
 *   blockingIssues,
 *   createHandover,
 *   isValidating,
 *   isCreating,
 * } = useHandoverWizard(ticketId, HandoverType.QA_TO_MAINTENANCE);
 *
 * if (isValidating) return <Spinner />;
 *
 * return (
 *   <div>
 *     <GateChecklist gates={validation?.gates_passed} />
 *     {!canHandover && (
 *       <BlockingIssues issues={blockingIssues} />
 *     )}
 *     <Button
 *       onClick={() => createHandover.mutate({ ... })}
 *       disabled={!canHandover}
 *       loading={isCreating}
 *     >
 *       Complete Handover
 *     </Button>
 *   </div>
 * );
 * ```
 */
export function useHandoverWizard(
  ticketId: string,
  handoverType: HandoverType,
  enabled = true
) {
  const validationQuery = useHandoverGateValidation(ticketId, handoverType, enabled);
  const createMutation = useCreateHandover();

  return {
    // Validation data
    validation: validationQuery.data,
    canHandover: validationQuery.data?.can_handover ?? false,
    blockingIssues: validationQuery.data?.blocking_issues ?? [],
    warnings: validationQuery.data?.warnings ?? [],
    gatesPassed: validationQuery.data?.gates_passed ?? [],
    gatesFailed: validationQuery.data?.gates_failed ?? [],

    // Loading states
    isValidating: validationQuery.isLoading,
    isValidationError: validationQuery.isError,
    validationError: validationQuery.error,
    isCreating: createMutation.isPending,
    isCreateError: createMutation.isError,
    createError: createMutation.error,

    // Actions
    createHandover: createMutation,
    refetchValidation: validationQuery.refetch,
  };
}

// Export all hooks
export default {
  useHandoverGateValidation,
  useCreateHandover,
  useHandoverHistory,
  useHandover,
  useHandoverWizard,
};
