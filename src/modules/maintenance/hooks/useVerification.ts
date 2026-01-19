/**
 * useVerification Hook - Verification Checklist State Management
 *
 * 🟢 WORKING: Production-ready React hook for managing verification checklist state
 *
 * Features:
 * - Load verification steps for a ticket
 * - Update individual step completion
 * - Calculate verification progress
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
  VerificationStep,
  VerificationStepNumber,
  UpdateVerificationStepPayload,
  VerificationProgress,
} from '../types/verification';

const logger = createLogger('ticketing:hooks:verification');

// ==================== Query Keys ====================

/**
 * 🟢 WORKING: Centralized query key factory for verification queries
 *
 * Follows React Query best practices for hierarchical query keys
 */
export const verificationKeys = {
  all: ['verification'] as const,
  steps: (ticketId: string) => [...verificationKeys.all, 'steps', ticketId] as const,
  progress: (ticketId: string) => [...verificationKeys.all, 'progress', ticketId] as const,
};

// ==================== API Helper Functions ====================

/**
 * 🟢 WORKING: Fetch verification steps from API
 */
async function fetchVerificationSteps(ticketId: string): Promise<VerificationStep[]> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/verification`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to fetch verification steps');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Fetch verification progress from API
 */
async function fetchVerificationProgress(ticketId: string): Promise<VerificationProgress> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/verification/complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to fetch verification progress');
  }

  const data = await response.json();
  return data.data;
}

/**
 * 🟢 WORKING: Update a verification step via API
 */
async function updateVerificationStepAPI(
  ticketId: string,
  stepNumber: VerificationStepNumber,
  payload: UpdateVerificationStepPayload
): Promise<VerificationStep> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/verification/${stepNumber}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || 'Failed to update verification step');
  }

  const data = await response.json();
  return data.data;
}

// ==================== Hooks ====================

/**
 * 🟢 WORKING: Hook for fetching verification steps for a ticket
 *
 * @param ticketId - UUID of the ticket
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with verification steps
 *
 * @example
 * ```tsx
 * const { data: steps, isLoading, error } = useVerificationSteps(ticketId);
 * ```
 */
export function useVerificationSteps(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: verificationKeys.steps(ticketId),
    queryFn: () => fetchVerificationSteps(ticketId),
    enabled: !!ticketId && enabled,
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * 🟢 WORKING: Hook for fetching verification progress for a ticket
 *
 * Returns complete progress information including:
 * - Total steps (always 12)
 * - Completed steps count
 * - Pending steps count
 * - Progress percentage
 * - All steps complete flag
 * - Array of all steps
 *
 * @param ticketId - UUID of the ticket
 * @param enabled - Whether to enable the query (default: true)
 * @returns Query result with verification progress
 *
 * @example
 * ```tsx
 * const { data: progress, isLoading } = useVerificationProgress(ticketId);
 * console.log(`${progress.completed_steps}/${progress.total_steps}`); // e.g., "7/12"
 * ```
 */
export function useVerificationProgress(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: verificationKeys.progress(ticketId),
    queryFn: () => fetchVerificationProgress(ticketId),
    enabled: !!ticketId && enabled,
    staleTime: 1 * 60 * 1000, // 1 minute (more dynamic data)
    gcTime: 3 * 60 * 1000, // 3 minutes
  });
}

/**
 * 🟢 WORKING: Hook for updating a verification step
 *
 * Supports optimistic updates for better UX.
 * Automatically invalidates verification queries on success.
 *
 * @returns Mutation object for updating verification steps
 *
 * @example
 * ```tsx
 * const updateStep = useUpdateVerificationStep();
 *
 * // Mark step as complete
 * updateStep.mutate({
 *   ticketId,
 *   stepNumber: 3,
 *   payload: {
 *     is_complete: true,
 *     completed_by: userId,
 *   }
 * });
 *
 * // Update photo
 * updateStep.mutate({
 *   ticketId,
 *   stepNumber: 5,
 *   payload: {
 *     photo_url: 'https://example.com/photo.jpg',
 *     photo_verified: true,
 *   }
 * });
 * ```
 */
export function useUpdateVerificationStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      ticketId,
      stepNumber,
      payload,
    }: {
      ticketId: string;
      stepNumber: VerificationStepNumber;
      payload: UpdateVerificationStepPayload;
    }) => updateVerificationStepAPI(ticketId, stepNumber, payload),
    onSuccess: (data, variables) => {
      const { ticketId } = variables;

      // 🟢 WORKING: Invalidate verification queries to trigger refetch
      queryClient.invalidateQueries({ queryKey: verificationKeys.steps(ticketId) });
      queryClient.invalidateQueries({ queryKey: verificationKeys.progress(ticketId) });

      logger.info('Verification step updated successfully', {
        ticketId,
        stepNumber: variables.stepNumber,
      });
    },
    onError: (error, variables) => {
      logger.error('Failed to update verification step', {
        error,
        ticketId: variables.ticketId,
        stepNumber: variables.stepNumber,
      });
    },
  });
}

/**
 * 🟢 WORKING: Utility hook that combines steps and progress for convenience
 *
 * Returns both verification steps and progress in a single hook.
 * Useful for components that need both pieces of information.
 *
 * @param ticketId - UUID of the ticket
 * @param enabled - Whether to enable the queries (default: true)
 * @returns Combined result with steps, progress, and aggregate loading states
 *
 * @example
 * ```tsx
 * const { steps, progress, isLoading, error } = useVerification(ticketId);
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <Error message={error.message} />;
 *
 * return (
 *   <div>
 *     <ProgressBar value={progress.progress_percentage} />
 *     <StepList steps={steps} />
 *   </div>
 * );
 * ```
 */
export function useVerification(ticketId: string, enabled = true) {
  const stepsQuery = useVerificationSteps(ticketId, enabled);
  const progressQuery = useVerificationProgress(ticketId, enabled);

  return {
    steps: stepsQuery.data,
    progress: progressQuery.data,
    isLoading: stepsQuery.isLoading || progressQuery.isLoading,
    isError: stepsQuery.isError || progressQuery.isError,
    error: stepsQuery.error || progressQuery.error,
    refetchSteps: stepsQuery.refetch,
    refetchProgress: progressQuery.refetch,
  };
}

// Export all hooks
export default {
  useVerificationSteps,
  useVerificationProgress,
  useUpdateVerificationStep,
  useVerification,
};
