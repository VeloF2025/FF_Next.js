/**
 * Step3Submit — Review & submit requisition for approval.
 * Provides a summary of the requisition and triggers the approval workflow.
 * Handles resuming when requisition was already submitted/approved outside the wizard.
 */

import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Clock,
  FileText,
  Send,
  ShoppingCart,
} from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import type { WorkflowState } from '../useWorkflowState';
import { log } from '@/lib/logger';
import { calcVat } from './requisitionUtils';

// 🟢 WORKING: display helpers
const formatCurrency = (value?: number) => {
  if (value === undefined || value === null) return '—';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(value);
};

const THRESHOLD = 10_000;

function getApprovalRouting(estimatedTotal?: number): {
  label: string;
  detail: string;
  variant: 'auto' | 'manual';
} {
  const totalInclVat = estimatedTotal !== undefined ? estimatedTotal + calcVat(estimatedTotal) : 0;
  if (totalInclVat < THRESHOLD) {
    return {
      variant: 'auto',
      label: 'Auto-Approved',
      detail: 'Under R10,000 threshold — no manager sign-off required.',
    };
  }
  return {
    variant: 'manual',
    label: 'Requires Manager Approval',
    detail: 'Orders ≥ R10,000 require manager approval before processing.',
  };
}

const STRATEGY_LABELS: Record<string, string> = {
  rfq: 'Request for Quotation (RFQ)',
  direct_po: 'Direct Purchase Order',
};

const STRATEGY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  rfq: Send,
  direct_po: ShoppingCart,
};

export interface Step3SubmitProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

interface SubmitResponseData {
  id: string;
  status: string;
  approvalStatus?: string;
  approvalRequestId?: string;
}

interface SubmitApiResponse {
  success: boolean;
  data?: SubmitResponseData;
  error?: { message: string };
}

/**
 * Step 3: Review requisition details and submit for approval.
 * Handles both auto-approve (< R10k) and pending-approval (>= R10k) paths.
 * If the requisition was already submitted/approved outside the wizard, auto-advances.
 */
export function Step3Submit({ state, onComplete, onBack }: Step3SubmitProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(true);

  const routing = getApprovalRouting(state.estimatedTotal);
  const StrategyIcon = state.strategy ? STRATEGY_ICONS[state.strategy] : null;

  // Check if the requisition was already submitted/approved outside the wizard
  useEffect(() => {
    if (!state.requisitionId) {
      setIsCheckingStatus(false);
      return;
    }

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/procurement/requisitions/${state.requisitionId}`, {
          credentials: 'include',
        });
        const json = await res.json();
        if (!json.success || !json.data) {
          setIsCheckingStatus(false);
          return;
        }

        const status = json.data.status as string;

        if (status === 'approved' || status === 'ordered' || status === 'partially_ordered') {
          // Already approved — skip to next step
          onComplete({ approvalStatus: 'auto_approved' });
          return;
        }

        if (status === 'pending_approval') {
          // Already submitted, waiting for approval
          onComplete({
            approvalStatus: 'pending',
            approvalRequestId: json.data.approvalRequestId ?? undefined,
          });
          return;
        }

        // Status is 'draft' — normal flow, show submit button
        setIsCheckingStatus(false);
      } catch (err) {
        log.error('Failed to check requisition status', { err }, 'Step3Submit');
        setIsCheckingStatus(false);
      }
    };

    checkStatus();
  }, [state.requisitionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (!state.requisitionId) {
      setError('Requisition ID is missing. Please go back to Step 1.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/procurement/requisitions/${state.requisitionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const json = (await res.json()) as SubmitApiResponse;

      if (!res.ok || !json.success) {
        setError(json.error?.message ?? `Submission failed (HTTP ${res.status})`);
        return;
      }

      const data = json.data;
      if (!data) {
        setError('Unexpected empty response from server.');
        return;
      }

      // Auto-approved path
      if (data.status === 'approved') {
        onComplete({ approvalStatus: 'auto_approved' });
        return;
      }

      // Pending approval path — Step 4 will fetch the approval request details
      onComplete({
        approvalStatus: 'pending',
        approvalRequestId: data.approvalRequestId,
      });
    } catch (err) {
      log.error('Requisition submission failed', { err }, 'Step3Submit');
      setError('A network error occurred. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingStatus) {
    return (
      <div className="flex items-center justify-center py-12 gap-3">
        <InlineSpinner size="sm" className="text-purple-400" />
        <span className="text-sm text-[var(--ff-text-secondary)]">Checking requisition status...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Heading */}
      <div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Review & Submit</h3>
        <p className="mt-1 text-sm text-[var(--ff-text-secondary)]">
          Confirm the details below before submitting for approval.
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Requisition summary card */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <FileText className="h-5 w-5 text-purple-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide">Requisition</p>
            <p className="text-sm font-semibold text-[var(--ff-text-primary)]">
              {state.requisitionNumber ?? '—'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[var(--ff-border-light)]">
          {/* Estimated total */}
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] mb-1">Estimated Total (incl. VAT)</p>
            <p className="text-2xl font-bold text-[var(--ff-text-primary)]">
              {state.estimatedTotal !== undefined
                ? formatCurrency(state.estimatedTotal + calcVat(state.estimatedTotal))
                : '—'}
            </p>
            {state.estimatedTotal !== undefined && (
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                Excl. VAT: {formatCurrency(state.estimatedTotal)} + VAT: {formatCurrency(calcVat(state.estimatedTotal))}
              </p>
            )}
          </div>

          {/* Project */}
          <div>
            <p className="text-xs text-[var(--ff-text-tertiary)] mb-1">Project</p>
            <p className="text-sm text-[var(--ff-text-primary)]">
              {state.projectName ?? <span className="text-[var(--ff-text-tertiary)]">No project selected</span>}
            </p>
          </div>

          {/* Strategy */}
          <div className="sm:col-span-2">
            <p className="text-xs text-[var(--ff-text-tertiary)] mb-1">Procurement Strategy</p>
            {state.strategy ? (
              <div className="inline-flex items-center gap-2">
                {StrategyIcon && <StrategyIcon className="h-4 w-4 text-[var(--ff-text-secondary)]" aria-hidden="true" />}
                <span className="text-sm text-[var(--ff-text-primary)]">
                  {STRATEGY_LABELS[state.strategy] ?? state.strategy}
                </span>
              </div>
            ) : (
              <span className="text-sm text-[var(--ff-text-tertiary)]">Not selected</span>
            )}
          </div>
        </div>
      </div>

      {/* Approval routing preview */}
      <div
        className={[
          'flex items-start gap-3 p-4 rounded-lg border',
          routing.variant === 'auto'
            ? 'bg-green-500/10 border-green-500/30'
            : 'bg-amber-500/10 border-amber-500/30',
        ].join(' ')}
        role="status"
        aria-live="polite"
      >
        {routing.variant === 'auto' ? (
          <CheckCircle className="h-5 w-5 text-green-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <Clock className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div>
          <p
            className={`text-sm font-semibold ${
              routing.variant === 'auto' ? 'text-green-400' : 'text-amber-400'
            }`}
          >
            {routing.label}
          </p>
          <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">{routing.detail}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
          disabled={isSubmitting}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Strategy
        </button>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting || !state.requisitionId}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <InlineSpinner size="sm" />
              Submitting...
            </>
          ) : (
            'Submit for Approval'
          )}
        </button>
      </div>
    </div>
  );
}
