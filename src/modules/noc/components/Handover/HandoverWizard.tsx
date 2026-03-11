/**
 * HandoverWizard Component - Guided handover process with gate validation
 *
 * 🟢 WORKING: Production-ready handover wizard component
 *
 * Features:
 * - Validate handover gates before allowing handover
 * - Display gate checklist with pass/fail status
 * - Show blocking issues and warnings
 * - Ownership transfer selection
 * - Create immutable handover snapshot
 * - Loading and error state handling
 * - Responsive design
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ArrowRight,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHandoverWizard } from '../../hooks/useHandover';
import type {
  HandoverType,
  OwnerType,
  HandoverSnapshot,
  HandoverGateCheck,
  HandoverBlocker,
} from '../../types/handover';

interface HandoverWizardProps {
  /** Ticket ID for handover */
  ticketId: string;
  /** Type of handover */
  handoverType: HandoverType;
  /** From owner type (optional) */
  fromOwnerType?: OwnerType;
  /** From owner ID (optional) */
  fromOwnerId?: string;
  /** To owner type (optional) */
  toOwnerType?: OwnerType;
  /** To owner ID (optional) */
  toOwnerId?: string;
  /** Callback when handover completes */
  onComplete?: (snapshot: HandoverSnapshot) => void;
  /** Callback when wizard is cancelled */
  onCancel?: () => void;
  /** Whether to show ownership transfer fields */
  showOwnershipFields?: boolean;
}

/**
 * 🟢 WORKING: Handover wizard with gate validation
 */
export function HandoverWizard({
  ticketId,
  handoverType,
  fromOwnerType,
  fromOwnerId,
  toOwnerType,
  toOwnerId,
  onComplete,
  onCancel,
  showOwnershipFields = true,
}: HandoverWizardProps) {
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // 🟢 WORKING: Use handover wizard hook
  const {
    validation,
    canHandover,
    blockingIssues,
    warnings,
    gatesPassed,
    gatesFailed,
    isValidating,
    isValidationError,
    validationError,
    isCreating,
    createHandover,
  } = useHandoverWizard(ticketId, handoverType);

  // 🟢 WORKING: Handle handover submission
  const handleSubmit = useCallback(async () => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    if (!canHandover) {
      setError('Cannot proceed with handover - there are blocking issues');
      return;
    }

    setError(null);

    try {
      createHandover.mutate(
        {
          ticket_id: ticketId,
          handover_type: handoverType,
          from_owner_type: fromOwnerType,
          from_owner_id: fromOwnerId,
          to_owner_type: toOwnerType,
          to_owner_id: toOwnerId,
          handover_by: user?.uid,
        },
        {
          onSuccess: (snapshot) => {
            onComplete?.(snapshot);
          },
          onError: (err) => {
            setError(err instanceof Error ? err.message : 'Failed to create handover');
          },
        }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    }
  }, [
    user,
    canHandover,
    ticketId,
    handoverType,
    fromOwnerType,
    fromOwnerId,
    toOwnerType,
    toOwnerId,
    createHandover,
    onComplete,
  ]);

  // 🟢 WORKING: Get handover type display name
  const getHandoverTypeName = (type: HandoverType): string => {
    const typeMap: Record<HandoverType, string> = {
      build_to_qa: 'Build to QA',
      qa_to_maintenance: 'QA to Maintenance',
      maintenance_complete: 'Maintenance Complete',
    };
    return typeMap[type] || type;
  };

  // 🟢 WORKING: Get owner type display name
  const getOwnerTypeName = (type: OwnerType): string => {
    const typeMap: Record<OwnerType, string> = {
      build: 'Build',
      qa: 'QA',
      maintenance: 'Maintenance',
    };
    return typeMap[type] || type;
  };

  // Loading state
  if (isValidating) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-[var(--ff-text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Validating handover gates...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (isValidationError) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-lg">
        <div className="flex items-start gap-3">
          <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-red-300">
              Failed to Validate Handover Gates
            </h3>
            <p className="text-sm text-red-400 mt-1">
              {validationError instanceof Error
                ? validationError.message
                : 'An unexpected error occurred'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">
            {getHandoverTypeName(handoverType)} Handover
          </h2>
          <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
            Validate gates and complete handover process
          </p>
        </div>

        {/* Locked indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <Lock className="w-4 h-4 text-blue-400" />
          <span className="text-sm text-blue-300">Snapshot will be locked</span>
        </div>
      </div>

      {/* Ownership Transfer */}
      {showOwnershipFields && (fromOwnerType || toOwnerType) && (
        <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
          <h3 className="text-sm font-medium text-[var(--ff-text-primary)] mb-3">Ownership Transfer</h3>
          <div className="flex items-center gap-3">
            {fromOwnerType && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] rounded-lg flex-1">
                <span className="text-sm text-[var(--ff-text-secondary)]">From:</span>
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                  {getOwnerTypeName(fromOwnerType)}
                </span>
              </div>
            )}
            {fromOwnerType && toOwnerType && (
              <ArrowRight className="w-5 h-5 text-[var(--ff-text-tertiary)] flex-shrink-0" />
            )}
            {toOwnerType && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[var(--ff-bg-secondary)] rounded-lg flex-1">
                <span className="text-sm text-[var(--ff-text-secondary)]">To:</span>
                <span className="text-sm font-medium text-[var(--ff-text-primary)]">
                  {getOwnerTypeName(toOwnerType)}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Handover Checklist */}
      <div className="space-y-4">
        <h3 className="text-base font-medium text-[var(--ff-text-primary)]">Handover Checklist</h3>

        {/* Gates Passed */}
        {gatesPassed.length > 0 && (
          <div className="space-y-2">
            {gatesPassed.map((gate) => (
              <GateCheckItem key={gate.gate_name} gate={gate} status="passed" />
            ))}
          </div>
        )}

        {/* Gates Failed */}
        {gatesFailed.length > 0 && (
          <div className="space-y-2">
            {gatesFailed.map((gate) => (
              <GateCheckItem key={gate.gate_name} gate={gate} status="failed" />
            ))}
          </div>
        )}

        {/* No gates to display */}
        {gatesPassed.length === 0 && gatesFailed.length === 0 && (
          <div className="p-4 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-center">
            <p className="text-sm text-[var(--ff-text-secondary)]">No gates to validate</p>
          </div>
        )}
      </div>

      {/* Blocking Issues */}
      {blockingIssues.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-medium text-red-300">Blocking Issues</h3>
          {blockingIssues.map((issue, index) => (
            <BlockingIssueItem key={index} issue={issue} />
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-base font-medium text-yellow-300">Warnings</h3>
          <div className="space-y-2">
            {warnings.map((warning, index) => (
              <div
                key={index}
                className="flex items-start gap-3 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg"
              >
                <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-200">{warning}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={isCreating}
            className="px-4 py-2 text-sm font-medium text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={!canHandover || isCreating}
          className={cn(
            'px-6 py-2 rounded-lg text-sm font-medium transition-all',
            'focus:outline-none focus:ring-2 focus:ring-blue-500/50',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            canHandover
              ? 'bg-blue-600 hover:bg-blue-700 text-[var(--ff-text-primary)]'
              : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] cursor-not-allowed'
          )}
        >
          {isCreating ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Creating Handover...</span>
            </span>
          ) : (
            'Complete Handover'
          )}
        </button>
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Gate check item component
 */
function GateCheckItem({
  gate,
  status,
}: {
  gate: HandoverGateCheck;
  status: 'passed' | 'failed';
}) {
  const isPassed = status === 'passed';

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 border rounded-lg',
        isPassed
          ? 'bg-green-500/10 border-green-500/20'
          : 'bg-red-500/10 border-red-500/20'
      )}
    >
      {isPassed ? (
        <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1">
        <p className={cn('text-sm font-medium', isPassed ? 'text-green-200' : 'text-red-200')}>
          {gate.message}
        </p>
        {gate.required && (
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">Required gate</p>
        )}
      </div>
    </div>
  );
}

/**
 * 🟢 WORKING: Blocking issue item component
 */
function BlockingIssueItem({ issue }: { issue: HandoverBlocker }) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'text-red-300 bg-red-500/10 border-red-500/20';
      case 'high':
        return 'text-orange-300 bg-orange-500/10 border-orange-500/20';
      case 'medium':
        return 'text-yellow-300 bg-yellow-500/10 border-yellow-500/20';
      default:
        return 'text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]';
    }
  };

  return (
    <div className={cn('p-4 border rounded-lg', getSeverityColor(issue.severity))}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium">{issue.message}</p>
          <p className="text-xs opacity-80 mt-2">
            <span className="font-medium">Resolution: </span>
            {issue.resolution_hint}
          </p>
        </div>
      </div>
    </div>
  );
}
