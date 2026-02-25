// WORKING: Step 4 — Approval Gate
import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck,
  CheckCircle,
  XCircle,
  Clock,
  Check,
  X,
  Loader2,
  Link as LinkIcon,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import type { WorkflowState } from '../useWorkflowState';
import { log } from '@/lib/logger';

interface Step4ApprovalProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

interface ApprovalTask {
  id: string;
  documentNumber?: string;
  documentType: string;
  documentAmount?: number;
  workflowName?: string;
  levelName?: string;
  requestedByName?: string;
  requestedAt: string;
  canApprove: boolean;
  canReject: boolean;
}

const formatCurrency = (value: number | undefined) => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
};

export function Step4Approval({ state, onComplete, onBack }: Step4ApprovalProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [task, setTask] = useState<ApprovalTask | null>(null);
  const [isActioning, setIsActioning] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);

  // Auto-approved case — skip straight through
  const isAutoApproved = state.approvalStatus === 'auto_approved';
  const isApproved = state.approvalStatus === 'approved';
  const isRejected = state.approvalStatus === 'rejected';

  const fetchApproval = useCallback(async () => {
    if (isAutoApproved || isApproved) return;

    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/procurement/approvals/pending');
      const data = await res.json();
      if (data.success) {
        const tasks: ApprovalTask[] = data.data.tasks || [];
        const found = state.approvalRequestId
          ? tasks.find((t) => t.id === state.approvalRequestId)
          : tasks.find((t) => t.documentType === 'purchase_requisition');

        if (found) {
          setTask(found);
        } else {
          // Not in pending list → might be approved
          setTask(null);
        }
      } else {
        setError(data.error?.message || 'Failed to fetch approval status');
      }
    } catch (err) {
      log.error('Failed to fetch approval tasks', { error: err });
      setError('Failed to load approval status');
    } finally {
      setIsLoading(false);
    }
  }, [state.approvalRequestId, isAutoApproved, isApproved]);

  useEffect(() => {
    void fetchApproval();
  }, [fetchApproval]);

  const handleApprove = async () => {
    if (!task) return;
    setIsActioning(true);
    try {
      const res = await fetch(`/api/procurement/approvals/${task.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: '' }),
      });
      const data = await res.json();
      if (data.success) {
        onComplete({ approvalStatus: 'approved', approvalRequestId: task.id });
      } else {
        setError(data.error?.message || 'Failed to approve');
      }
    } catch (err) {
      log.error('Failed to approve requisition', { error: err });
      setError('Failed to approve');
    } finally {
      setIsActioning(false);
    }
  };

  const handleReject = async () => {
    if (!task || !rejectReason.trim()) return;
    setIsActioning(true);
    try {
      const res = await fetch(`/api/procurement/approvals/${task.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const data = await res.json();
      if (data.success) {
        onComplete({ approvalStatus: 'rejected', approvalRequestId: task.id });
        setShowRejectModal(false);
      } else {
        setError(data.error?.message || 'Failed to reject');
      }
    } catch (err) {
      log.error('Failed to reject requisition', { error: err });
      setError('Failed to reject');
    } finally {
      setIsActioning(false);
    }
  };

  const copyShareLink = () => {
    const url = new URL(window.location.href);
    if (state.requisitionId) url.searchParams.set('reqId', state.requisitionId);
    if (task?.id) url.searchParams.set('approvalId', task.id);
    url.searchParams.set('step', '4');
    void navigator.clipboard.writeText(url.toString());
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Auto-approved
  if (isAutoApproved) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-8 text-center">
          <div className="inline-flex p-4 rounded-full bg-green-500/20 mb-4">
            <CheckCircle className="h-12 w-12 text-green-400" />
          </div>
          <h2 className="text-2xl font-semibold text-[var(--ff-text-primary)] mb-2">Auto-Approved</h2>
          <p className="text-[var(--ff-text-secondary)] mb-2">
            This requisition was automatically approved — under the R10,000 threshold.
          </p>
          <p className="text-sm text-[var(--ff-text-tertiary)] mb-6">
            Estimated total: {formatCurrency(state.estimatedTotal)}
          </p>
          <button
            onClick={() => onComplete({ approvalStatus: 'auto_approved' })}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Check className="h-4 w-4" />
            Continue to Create Order
          </button>
        </div>
      </div>
    );
  }

  // Rejected
  if (isRejected) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-[var(--ff-bg-secondary)] border border-red-500/30 rounded-lg p-8 text-center">
          <div className="inline-flex p-4 rounded-full bg-red-500/20 mb-4">
            <XCircle className="h-12 w-12 text-red-400" />
          </div>
          <h2 className="text-2xl font-semibold text-[var(--ff-text-primary)] mb-2">Request Rejected</h2>
          <p className="text-[var(--ff-text-secondary)] mb-6">
            This requisition was rejected. You may edit and resubmit or start a new request.
          </p>
          <button
            onClick={onBack}
            className="px-6 py-2.5 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-lg hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <ClipboardCheck className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Approval Gate</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {state.requisitionNumber || 'Requisition'} — {formatCurrency(state.estimatedTotal)}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
            <span className="text-sm text-red-400">{error}</span>
          </div>
        )}

        {task ? (
          task.canApprove ? (
            // Approver view
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-sm text-amber-300 font-medium mb-1">Action Required</p>
                <p className="text-[var(--ff-text-secondary)] text-sm">
                  {task.workflowName} • {task.levelName}
                </p>
                {task.documentAmount !== undefined && (
                  <p className="text-lg font-semibold text-[var(--ff-text-primary)] mt-2">
                    {formatCurrency(task.documentAmount)}
                  </p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleApprove}
                  disabled={isActioning}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isActioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={isActioning}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Reject
                </button>
              </div>
            </div>
          ) : (
            // Requester view — waiting
            <div className="space-y-4">
              <div className="p-4 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg flex items-center gap-3">
                <Clock className="h-5 w-5 text-amber-400 animate-pulse" />
                <div>
                  <p className="text-[var(--ff-text-primary)] font-medium">Waiting for approval</p>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    {task.workflowName} • {task.levelName}
                  </p>
                </div>
              </div>
              <button
                onClick={copyShareLink}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] rounded-lg hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-hover)] transition-colors text-sm"
              >
                <LinkIcon className="h-4 w-4" />
                {linkCopied ? 'Link copied!' : 'Copy approval link for approver'}
              </button>
            </div>
          )
        ) : (
          // Not found in pending — likely approved
          <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
            <p className="text-green-400 font-medium">Approval may have been processed.</p>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Not found in pending approvals — it may have been approved already.
            </p>
            <button
              onClick={() => onComplete({ approvalStatus: 'approved' })}
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
            >
              <Check className="h-4 w-4" />
              Continue to Create Order
            </button>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => void fetchApproval()}
            className="inline-flex items-center gap-1.5 text-sm text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh status
          </button>
          <button
            onClick={onBack}
            className="text-sm text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-secondary)] transition-colors"
          >
            Back
          </button>
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Reject Requisition</h3>
            <label className="block text-sm text-[var(--ff-text-secondary)] mb-2">
              Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Please provide a reason..."
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-red-500/50 resize-none mb-4"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleReject()}
                disabled={!rejectReason.trim() || isActioning}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                {isActioning ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
