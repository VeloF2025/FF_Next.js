/**
 * QAReadinessCheck Component - Main QA readiness check interface
 *
 * 🟢 WORKING: Production-ready QA readiness check component
 *
 * Features:
 * - Display current QA readiness status
 * - Run readiness checks on demand
 * - Show latest check results
 * - Loading and error states
 * - Automatic refresh after running check
 */

'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ReadinessResults } from './ReadinessResults';
import { cn } from '@/lib/utils';
import type { QAReadinessStatus } from '../../types/verification';

interface QAReadinessCheckProps {
  /** Ticket ID to check readiness for */
  ticketId: string;
  /** Auto-refresh interval in ms (0 = no auto-refresh) */
  autoRefreshInterval?: number;
  /** Callback when check completes */
  onCheckComplete?: (status: QAReadinessStatus) => void;
}

/**
 * 🟢 WORKING: Fetch QA readiness status from API
 */
async function fetchReadinessStatus(ticketId: string): Promise<QAReadinessStatus> {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/qa-readiness`);

  if (!response.ok) {
    throw new Error('Failed to fetch QA readiness status');
  }

  const result = await response.json();
  return result.data;
}

/**
 * 🟢 WORKING: Run QA readiness check via API
 */
async function runReadinessCheckAPI(ticketId: string, checkedBy: string | null) {
  const response = await fetch(`/api/ticketing/tickets/${ticketId}/qa-readiness-check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ checked_by: checkedBy }),
  });

  if (!response.ok) {
    throw new Error('Failed to run QA readiness check');
  }

  const result = await response.json();
  return result.data;
}

/**
 * 🟢 WORKING: Main QA readiness check component
 */
export function QAReadinessCheck({
  ticketId,
  autoRefreshInterval = 0,
  onCheckComplete,
}: QAReadinessCheckProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

  // 🟢 WORKING: Query for current readiness status
  const {
    data: status,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<QAReadinessStatus>({
    queryKey: ['qaReadiness', ticketId],
    queryFn: () => fetchReadinessStatus(ticketId),
    refetchInterval: autoRefreshInterval > 0 ? autoRefreshInterval : false,
  });

  // 🟢 WORKING: Mutation to run readiness check
  const runCheckMutation = useMutation({
    mutationFn: () => runReadinessCheckAPI(ticketId, user?.uid || null),
    onSuccess: () => {
      // Invalidate and refetch status
      queryClient.invalidateQueries({ queryKey: ['qaReadiness', ticketId] });
      setLastRunAt(new Date());

      // Refetch to get updated status
      refetch().then((result) => {
        if (result.data && onCheckComplete) {
          onCheckComplete(result.data);
        }
      });
    },
  });

  // 🟢 WORKING: Handle run check button click
  const handleRunCheck = () => {
    runCheckMutation.mutate();
  };

  // 🟢 WORKING: Loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <Loader2 className="w-6 h-6 text-[var(--ff-text-secondary)] animate-spin" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">Loading QA readiness status...</span>
      </div>
    );
  }

  // 🟢 WORKING: Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center p-8 bg-red-500/10 border border-red-500/20 rounded-lg">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <span className="ml-2 text-red-400">
          Failed to load QA readiness status: {error?.message || 'Unknown error'}
        </span>
      </div>
    );
  }

  // 🟢 WORKING: Empty state (should not happen with our API design)
  if (!status) {
    return (
      <div className="flex items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <AlertCircle className="w-6 h-6 text-[var(--ff-text-secondary)]" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">No readiness status available</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with status and run button */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">QA Readiness Status</h3>
            <p className="text-sm text-[var(--ff-text-secondary)]">{status.next_action}</p>
          </div>

          <button
            onClick={handleRunCheck}
            disabled={runCheckMutation.isPending}
            className={cn(
              'flex items-center px-4 py-2 rounded-lg font-medium transition-all',
              'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              runCheckMutation.isPending && 'animate-pulse'
            )}
          >
            {runCheckMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Running Check...
              </>
            ) : status.last_check ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Re-run Check
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4 mr-2" />
                Run Readiness Check
              </>
            )}
          </button>
        </div>

        {/* Status badge */}
        <div className="flex items-center">
          <div
            className={cn(
              'inline-flex items-center px-4 py-2 rounded-full font-semibold',
              status.is_ready
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-red-500/20 text-red-400 border border-red-500/30'
            )}
          >
            {status.is_ready ? '✓ Ready for QA' : '✗ Not Ready'}
          </div>
          {status.last_check_at && (
            <span className="ml-3 text-sm text-[var(--ff-text-secondary)]">
              Last checked: {new Date(status.last_check_at).toLocaleString()}
            </span>
          )}
        </div>

        {/* Failed reasons summary (if not ready) */}
        {!status.is_ready && status.failed_reasons && status.failed_reasons.length > 0 && (
          <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-sm font-semibold text-red-400 mb-2">
              {status.failed_reasons.length} issue{status.failed_reasons.length !== 1 ? 's' : ''} preventing QA:
            </p>
            <ul className="space-y-1">
              {status.failed_reasons.map((reason, index) => (
                <li key={index} className="text-sm text-red-300 flex items-start">
                  <span className="mr-2">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Success message (if ready) */}
        {status.is_ready && (
          <div className="mt-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <p className="text-sm text-green-400">
              ✓ All QA requirements met. This ticket can proceed to QA review.
            </p>
          </div>
        )}
      </div>

      {/* Detailed results (if check has been run) */}
      {status.last_check && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <h4 className="text-md font-semibold text-[var(--ff-text-primary)] mb-3">Detailed Check Results</h4>
          <ReadinessResults check={status.last_check} />
        </div>
      )}

      {/* No check run yet message */}
      {!status.last_check && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 text-center">
          <AlertCircle className="w-12 h-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
          <p className="text-[var(--ff-text-secondary)] mb-2">No readiness checks have been run yet</p>
          <p className="text-sm text-[var(--ff-text-tertiary)]">
            Click "Run Readiness Check" to validate QA requirements
          </p>
        </div>
      )}

      {/* Last run timestamp (if check was just run) */}
      {lastRunAt && (
        <div className="text-center text-sm text-[var(--ff-text-tertiary)]">
          Check completed at {lastRunAt.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
