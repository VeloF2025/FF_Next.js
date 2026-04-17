/**
 * VerificationChecklist Component - 12-step verification checklist
 *
 * 🟢 WORKING: Production-ready verification checklist component
 *
 * Features:
 * - Display all 12 verification steps
 * - Progress tracking (e.g., "7/12" - 58%)
 * - Step completion toggle
 * - Photo upload per step
 * - Category grouping (optional)
 * - Loading and error states
 * - Editable/read-only modes
 * - Responsive design
 */

'use client';

import { useCallback } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuth } from '@/contexts/AuthContext';
import { VerificationStep } from './VerificationStep';
import { useVerification, useUpdateVerificationStep } from '../../hooks/useVerification';
import { canApproveQA } from '@/modules/construction-qa/utils/snagPermissions';
import { cn } from '@/lib/utils';
import type { VerificationStepNumber } from '../../types/verification';
import { TicketStatus } from '../../types/ticket';
import { VERIFICATION_STEPS_BY_CATEGORY } from '../../constants/verificationSteps';

/** Statuses where QA approve/reject actions are shown in the checklist */
const QA_REVIEW_STATUSES = new Set<TicketStatus>([TicketStatus.PENDING_QA, TicketStatus.QA_IN_PROGRESS]);

interface VerificationChecklistProps {
  /** Ticket ID to load verification steps for */
  ticketId: string;
  /** Whether checklist is editable */
  editable?: boolean;
  /** Whether to group steps by category */
  groupByCategory?: boolean;
  /** Compact mode for smaller display */
  compact?: boolean;
  /** Callback when all steps are complete */
  onAllComplete?: () => void;
  /** Current ticket status — used to show QA approve/reject actions */
  ticketStatus?: TicketStatus;
  /** Called when a QA action moves the ticket to a new status */
  onStatusChange?: (newStatus: string) => void;
}

/**
 * 🟢 WORKING: 12-step verification checklist component
 */
export function VerificationChecklist({
  ticketId,
  editable = true,
  groupByCategory = false,
  compact = false,
  onAllComplete,
  ticketStatus,
  onStatusChange,
}: VerificationChecklistProps) {
  const { user, currentUser } = useAuth();
  const isQAApprover = canApproveQA({
    userId: currentUser?.id ?? null,
    userRole: currentUser?.role ?? null,
    ticketAssignedTo: null,
  });
  const showQAActions = !!ticketStatus && QA_REVIEW_STATUSES.has(ticketStatus) && isQAApprover;
  const { steps, progress, isLoading, isError, error } = useVerification(ticketId);
  const updateStep = useUpdateVerificationStep();

  // 🟢 WORKING: Handle step toggle
  const handleStepToggle = useCallback(
    (stepNumber: VerificationStepNumber, isComplete: boolean) => {
      if (!user?.uid) {
        return;
      }

      updateStep.mutate({
        ticketId,
        stepNumber,
        payload: {
          is_complete: isComplete,
          completed_by: isComplete ? user?.uid : undefined,
        },
      });

      // Check if all steps will be complete
      if (progress && isComplete) {
        const willBeComplete = progress.completed_steps + 1 === progress.total_steps;
        if (willBeComplete && onAllComplete) {
          onAllComplete();
        }
      }
    },
    [ticketId, user?.uid, updateStep, progress, onAllComplete]
  );

  // Photo uploads happen inside `VerificationStepPhotos` — it POSTs to the
  // attachments API and invalidates the verification query on success.

  // 🟢 WORKING: Loading state
  if (isLoading) {
    return (
      <LoadingSpinner className="p-8" label="Loading verification steps..." />
    );
  }

  // 🟢 WORKING: Error state
  if (isError) {
    return (
      <div className="flex items-center justify-center p-8 bg-red-500/10 border border-red-500/20 rounded-lg">
        <AlertCircle className="w-6 h-6 text-red-400" />
        <span className="ml-2 text-red-400">
          Failed to load verification steps: {error?.message || 'Unknown error'}
        </span>
      </div>
    );
  }

  // 🟢 WORKING: Empty state (no steps)
  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <AlertCircle className="w-6 h-6 text-[var(--ff-text-secondary)]" />
        <span className="ml-2 text-[var(--ff-text-secondary)]">
          No verification steps found. Please initialize verification steps first.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      {progress && (
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Verification Progress</h3>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {progress.completed_steps}/{progress.total_steps} steps completed
              </p>
            </div>
            {progress.all_steps_complete ? (
              <div className="flex items-center text-green-400">
                <CheckCircle2 className="w-6 h-6 mr-2" />
                <span className="font-semibold">Complete!</span>
              </div>
            ) : (
              <div className="text-right">
                <div className="text-2xl font-bold text-[var(--ff-text-primary)]">{progress.progress_percentage}%</div>
                <div className="text-xs text-[var(--ff-text-secondary)]">{progress.pending_steps} remaining</div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="w-full bg-[var(--ff-bg-tertiary)] rounded-full h-3 overflow-hidden">
            <div
              className={cn(
                'h-3 rounded-full transition-all duration-500',
                progress.all_steps_complete
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500'
                  : 'bg-gradient-to-r from-blue-500 to-cyan-500'
              )}
              style={{ width: `${progress.progress_percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Steps list */}
      {groupByCategory ? (
        // Grouped by category
        <div className="space-y-6">
          {(['preparation', 'installation', 'testing', 'documentation'] as const).map((category) => {
            const categorySteps = steps.filter((step) => {
              const stepNumber = step.step_number as VerificationStepNumber;
              return VERIFICATION_STEPS_BY_CATEGORY[category].some(
                (template) => template.step_number === stepNumber
              );
            });

            if (categorySteps.length === 0) return null;

            return (
              <div key={category}>
                <h4 className="text-sm font-semibold text-[var(--ff-text-primary)] uppercase tracking-wide mb-3">
                  {category}
                </h4>
                <ul className="space-y-3">
                  {categorySteps.map((step) => (
                    <VerificationStep
                      key={step.id}
                      ticketId={ticketId}
                      step={step}
                      onToggle={handleStepToggle}
                      editable={editable}
                      compact={compact}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        // Linear list
        <ul className="space-y-3">
          {steps.map((step) => (
            <VerificationStep
              key={step.id}
              ticketId={ticketId}
              step={step}
              onToggle={handleStepToggle}
              editable={editable}
              compact={compact}
            />
          ))}
        </ul>
      )}

      {/* QA approve / reject actions — only for QA approvers on pending_qa/qa_in_progress tickets */}
      {showQAActions && onStatusChange && (
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--ff-border-light)]">
          <button
            type="button"
            onClick={() => onStatusChange('in_progress')}
            className="text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-200 px-4 py-2.5 rounded font-medium transition-colors"
          >
            ← Reject QA
          </button>
          <button
            type="button"
            onClick={() => onStatusChange('resolved')}
            className="text-sm bg-green-800 hover:bg-green-700 text-green-100 px-4 py-2.5 rounded font-medium transition-colors"
          >
            Approve QA →
          </button>
        </div>
      )}
    </div>
  );
}