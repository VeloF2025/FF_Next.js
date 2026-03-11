/**
 * ReadinessBlocker Component - Block/allow QA based on readiness status
 *
 * 🟢 WORKING: Production-ready QA blocker component
 *
 * Features:
 * - Block QA button when not ready
 * - Enable QA button when ready
 * - Display blocking reasons clearly
 * - Show success message when ready
 * - Visual feedback for different states
 * - Clear call-to-action messaging
 */

'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Lock, PlayCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QAReadinessCheck } from '../../types/verification';

interface ReadinessBlockerProps {
  /** Whether ticket is ready for QA */
  isReady: boolean;
  /** Last readiness check (null if not run) */
  lastCheck: QAReadinessCheck | null;
  /** Failed reasons (null if ready or not checked) */
  failedReasons: string[] | null;
  /** Callback when Start QA button is clicked */
  onStartQA: () => void;
  /** Custom button text */
  buttonText?: string;
  /** Show compact version */
  compact?: boolean;
}

/**
 * 🟢 WORKING: QA readiness blocker component
 */
export function ReadinessBlocker({
  isReady,
  lastCheck,
  failedReasons,
  onStartQA,
  buttonText = 'Start QA',
  compact = false,
}: ReadinessBlockerProps) {
  // 🟢 WORKING: Determine state and messaging
  const hasBeenChecked = lastCheck !== null;
  const canProceed = isReady && hasBeenChecked;

  return (
    <div
      className={cn(
        'border rounded-lg',
        canProceed
          ? 'bg-green-500/10 border-green-500/30'
          : hasBeenChecked
          ? 'bg-red-500/10 border-red-500/30'
          : 'bg-yellow-500/10 border-yellow-500/30',
        compact ? 'p-3' : 'p-4'
      )}
    >
      {/* Ready state - show success message and enabled button */}
      {canProceed && (
        <div className="space-y-3">
          <div className="flex items-start">
            <CheckCircle2 className="w-6 h-6 text-green-400 flex-shrink-0 mt-0.5" />
            <div className="ml-3 flex-1">
              <h4 className="font-semibold text-green-400">Ready for QA</h4>
              <p className={cn('text-[var(--ff-text-primary)]', compact ? 'text-sm' : 'text-base')}>
                All requirements met. You can proceed to QA review.
              </p>
              {lastCheck && (
                <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
                  Last verified: {new Date(lastCheck.checked_at).toLocaleString()}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onStartQA}
            className={cn(
              'w-full flex items-center justify-center px-4 py-3 rounded-lg font-semibold transition-all',
              'bg-green-500 text-white hover:bg-green-600',
              'shadow-lg shadow-green-500/20 hover:shadow-green-500/30',
              compact && 'py-2 text-sm'
            )}
          >
            <PlayCircle className="w-5 h-5 mr-2" />
            {buttonText}
          </button>
        </div>
      )}

      {/* Not ready state - show blocking reasons and disabled button */}
      {!canProceed && hasBeenChecked && (
        <div className="space-y-3">
          <div className="flex items-start">
            <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div className="ml-3 flex-1">
              <h4 className="font-semibold text-red-400">Cannot Start QA</h4>
              <p className={cn('text-[var(--ff-text-primary)]', compact ? 'text-sm' : 'text-base')}>
                This ticket does not meet QA requirements. Please resolve the issues below.
              </p>
            </div>
          </div>

          {/* List of blocking reasons */}
          {failedReasons && failedReasons.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <p className="text-sm font-semibold text-red-400 mb-2">
                {failedReasons.length} Blocking Issue{failedReasons.length !== 1 ? 's' : ''}:
              </p>
              <ul className="space-y-1.5">
                {failedReasons.map((reason, index) => (
                  <li key={index} className="text-sm text-red-300 flex items-start">
                    <span className="mr-2 text-red-400">✗</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={onStartQA}
            disabled={true}
            className={cn(
              'w-full flex items-center justify-center px-4 py-3 rounded-lg font-semibold',
              'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-tertiary)] cursor-not-allowed',
              'border border-[var(--ff-border-light)]',
              compact && 'py-2 text-sm'
            )}
          >
            <Lock className="w-5 h-5 mr-2" />
            {buttonText} (Blocked)
          </button>

          <p className="text-xs text-center text-[var(--ff-text-secondary)]">
            Resolve all issues and re-run the readiness check to proceed
          </p>
        </div>
      )}

      {/* Not checked state - prompt to run check first */}
      {!hasBeenChecked && (
        <div className="space-y-3">
          <div className="flex items-start">
            <AlertCircle className="w-6 h-6 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div className="ml-3 flex-1">
              <h4 className="font-semibold text-yellow-400">Readiness Check Required</h4>
              <p className={cn('text-[var(--ff-text-primary)]', compact ? 'text-sm' : 'text-base')}>
                Run readiness check first to verify QA requirements.
              </p>
            </div>
          </div>

          <button
            onClick={onStartQA}
            disabled={true}
            className={cn(
              'w-full flex items-center justify-center px-4 py-3 rounded-lg font-semibold',
              'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-tertiary)] cursor-not-allowed',
              'border border-[var(--ff-border-light)]',
              compact && 'py-2 text-sm'
            )}
          >
            <Lock className="w-5 h-5 mr-2" />
            {buttonText} (Check Required)
          </button>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3">
            <p className="text-sm text-yellow-300 text-center">
              Click "Run Readiness Check" above to validate QA requirements
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
