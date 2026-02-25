/**
 * Step8PaymentApproval — Finance payment approval gate
 * Polls pending approvals, shows Approve/Reject for authorised users.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  Loader2,
  Link as LinkIcon,
} from 'lucide-react';
import { log } from '@/lib/logger';
import type { WorkflowState } from '../useWorkflowState';

// 🟢 WORKING: full type coverage
interface Step8PaymentApprovalProps {
  state: WorkflowState;
  onComplete: (update: Partial<WorkflowState>) => void;
  onBack: () => void;
}

interface ApprovalTask {
  id: string;
  documentType: string;
  documentNumber?: string;
  documentAmount?: number;
  workflowName: string;
  levelName: string;
  canApprove: boolean;
  canReject: boolean;
  requestNotes?: string;
  dueDate?: string;
  isOverdue: boolean;
}

type ApprovalView = 'loading' | 'pending_can_approve' | 'pending_waiting' | 'approved' | 'rejected' | 'error';

const formatCurrency = (value: number | undefined): string => {
  if (value === undefined) return '-';
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
  }).format(value);
};

export const Step8PaymentApproval: React.FC<Step8PaymentApprovalProps> = ({ state, onComplete, onBack }) => {
  const [view, setView] = useState<ApprovalView>('loading');
  const [task, setTask] = useState<ApprovalTask | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // If already approved/rejected from prior state, jump to view
  useEffect(() => {
    if (state.paymentApprovalStatus === 'approved') setView('approved');
    else if (state.paymentApprovalStatus === 'rejected') setView('rejected');
  }, [state.paymentApprovalStatus]);

  const fetchStatus = useCallback(async () => {
    if (!state.paymentApprovalRequestId) {
      setView('approved'); // No request ID → auto-approved
      return;
    }
    if (state.paymentApprovalStatus === 'approved') { setView('approved'); return; }
    if (state.paymentApprovalStatus === 'rejected') { setView('rejected'); return; }

    setView('loading');
    setFetchError(null);
    try {
      const res = await fetch('/api/procurement/approvals/pending');
      const json = await res.json() as { success: boolean; data?: { tasks: ApprovalTask[] }; message?: string };
      if (!json.success) throw new Error(json.message ?? 'Failed to fetch approvals');

      const tasks = json.data?.tasks ?? [];
      const found = tasks.find((t) => t.id === state.paymentApprovalRequestId);

      if (!found) {
        // Not in pending list — treat as approved
        setView('approved');
        return;
      }

      setTask(found);
      setView(found.canApprove ? 'pending_can_approve' : 'pending_waiting');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to check approval status';
      log.error('Step8PaymentApproval: status fetch failed', { err }, 'procurement');
      setFetchError(msg);
      setView('error');
    }
  }, [state.paymentApprovalRequestId, state.paymentApprovalStatus]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleApprove = async () => {
    if (!state.paymentApprovalRequestId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/procurement/approvals/${state.paymentApprovalRequestId}/approve`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: '' }) }
      );
      const json = await res.json() as { success: boolean; message?: string };
      if (!json.success) throw new Error(json.message ?? 'Failed to approve');
      onComplete({ paymentApprovalStatus: 'approved' });
      setView('approved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Approval failed';
      log.error('Step8PaymentApproval: approve failed', { err }, 'procurement');
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!state.paymentApprovalRequestId || !rejectReason.trim()) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(
        `/api/procurement/approvals/${state.paymentApprovalRequestId}/reject`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: rejectReason }) }
      );
      const json = await res.json() as { success: boolean; message?: string };
      if (!json.success) throw new Error(json.message ?? 'Failed to reject');
      onComplete({ paymentApprovalStatus: 'rejected' });
      setView('rejected');
      setRejectModalOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rejection failed';
      log.error('Step8PaymentApproval: reject failed', { err }, 'procurement');
      setActionError(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const copyShareLink = () => {
    const url = `${window.location.origin}/procurement/approvals`;
    void navigator.clipboard.writeText(url);
  };

  // ---- VIEWS ----
  if (view === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48 }}>
        <Loader2 style={{ width: 24, height: 24, animation: 'spin 1s linear infinite', color: 'var(--ff-text-secondary)' }} />
        <span style={{ marginLeft: 10, color: 'var(--ff-text-secondary)' }}>Checking approval status…</span>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <ErrorView message={fetchError ?? 'Unknown error'} onRetry={() => void fetchStatus()} onBack={onBack} />
    );
  }

  if (view === 'approved') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)', borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <CheckCircle style={{ width: 44, height: 44, color: '#16a34a', margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--ff-text-primary)', marginBottom: 4 }}>Payment Approved</p>
          {state.paymentApprovalRequestId && (
            <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)' }}>Ref: {state.paymentApprovalRequestId}</p>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => onComplete({ paymentApprovalStatus: 'approved' })} style={primaryBtn('#16a34a')}>
            Complete Journey <ArrowRight style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>
    );
  }

  if (view === 'rejected') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <XCircle style={{ width: 44, height: 44, color: '#dc2626', margin: '0 auto 12px' }} />
          <p style={{ fontWeight: 700, fontSize: 18, color: 'var(--ff-text-primary)', marginBottom: 4 }}>Payment Rejected</p>
          <p style={{ fontSize: 14, color: 'var(--ff-text-secondary)' }}>The payment request was not approved.</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <button onClick={onBack} style={backBtn}>
            <ArrowLeft style={{ width: 16, height: 16 }} /> Back
          </button>
          <button onClick={() => onComplete({ paymentApprovalStatus: 'rejected' })} style={primaryBtn('#dc2626')}>
            Start Over
          </button>
        </div>
      </div>
    );
  }

  // ---- Pending views (can approve / waiting) ----
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldCheck style={{ width: 22, height: 22, color: '#059669' }} />
        <div>
          <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ff-text-primary)', margin: 0 }}>Finance Approval</p>
          <p style={{ fontSize: 13, color: 'var(--ff-text-secondary)', margin: 0 }}>
            {view === 'pending_can_approve' ? 'Action required — you can approve this request' : 'Waiting for Finance team approval'}
          </p>
        </div>
      </div>

      {/* Task detail card */}
      {task && <TaskCard task={task} />}

      {/* Waiting state */}
      {view === 'pending_waiting' && (
        <div style={{ background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 10, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Clock style={{ width: 20, height: 20, color: '#2563eb', flexShrink: 0, animation: 'pulse 2s infinite' }} />
          <p style={{ fontSize: 14, color: 'var(--ff-text-primary)', margin: 0 }}>Waiting for Finance approval…</p>
          <button onClick={copyShareLink} title="Copy approvals link" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#2563eb', background: 'none', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
            <LinkIcon style={{ width: 12, height: 12 }} /> Share Link
          </button>
        </div>
      )}

      {/* Action error */}
      {actionError && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', display: 'flex', gap: 8 }}>
          <AlertCircle style={{ width: 16, height: 16, color: '#ef4444', flexShrink: 0 }} />
          <span style={{ fontSize: 14, color: '#ef4444' }}>{actionError}</span>
        </div>
      )}

      {/* Navigation row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={backBtn}>
          <ArrowLeft style={{ width: 16, height: 16 }} /> Back
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => void fetchStatus()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', border: '1px solid var(--ff-border-light)', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--ff-text-secondary)', fontSize: 14 }}>
            <RefreshCw style={{ width: 14, height: 14 }} /> Refresh Status
          </button>

          {view === 'pending_can_approve' && (
            <>
              <button
                onClick={() => setRejectModalOpen(true)}
                disabled={actionLoading}
                style={{ padding: '9px 16px', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', color: '#dc2626', fontWeight: 600, fontSize: 14 }}
              >
                Reject
              </button>
              <button
                onClick={() => void handleApprove()}
                disabled={actionLoading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: actionLoading ? 'var(--ff-bg-tertiary)' : '#059669', color: actionLoading ? 'var(--ff-text-tertiary)' : '#fff', border: 'none', borderRadius: 8, cursor: actionLoading ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 14 }}
              >
                {actionLoading
                  ? <><Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} /> Processing…</>
                  : <><CheckCircle style={{ width: 14, height: 14 }} /> Approve Payment</>
                }
              </button>
            </>
          )}
        </div>
      </div>

      {/* Reject modal */}
      {rejectModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'var(--ff-bg-primary)', borderRadius: 12, padding: 28, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--ff-text-primary)', marginBottom: 8 }}>Reject Payment Request</p>
            <p style={{ fontSize: 14, color: 'var(--ff-text-secondary)', marginBottom: 16 }}>Please provide a reason for rejection.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Rejection reason…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--ff-border-light)', borderRadius: 8, background: 'var(--ff-bg-primary)', color: 'var(--ff-text-primary)', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button onClick={() => { setRejectModalOpen(false); setRejectReason(''); }} style={{ padding: '8px 16px', border: '1px solid var(--ff-border-light)', borderRadius: 8, cursor: 'pointer', background: 'transparent', color: 'var(--ff-text-secondary)', fontSize: 14 }}>
                Cancel
              </button>
              <button
                onClick={() => void handleReject()}
                disabled={!rejectReason.trim() || actionLoading}
                style={{ padding: '8px 16px', background: !rejectReason.trim() || actionLoading ? 'var(--ff-bg-tertiary)' : '#dc2626', color: !rejectReason.trim() || actionLoading ? 'var(--ff-text-tertiary)' : '#fff', border: 'none', borderRadius: 8, cursor: rejectReason.trim() && !actionLoading ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: 14 }}
              >
                {actionLoading ? 'Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- Internal components ----

const TaskCard: React.FC<{ task: ApprovalTask }> = ({ task }) => (
  <div style={{ background: 'var(--ff-bg-secondary)', borderRadius: 10, padding: '14px 18px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
    {task.workflowName && <InfoRow label="Workflow" value={task.workflowName} />}
    {task.levelName && <InfoRow label="Level" value={task.levelName} />}
    {task.documentNumber && <InfoRow label="Invoice Ref" value={task.documentNumber} />}
    {task.documentAmount !== undefined && <InfoRow label="Amount" value={formatCurrency(task.documentAmount)} />}
    {task.dueDate && <InfoRow label="Due" value={new Date(task.dueDate).toLocaleDateString('en-ZA')} />}
    {task.isOverdue && (
      <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', gap: 6 }}>
        <AlertCircle style={{ width: 14, height: 14, color: '#dc2626' }} />
        <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Overdue</span>
      </div>
    )}
  </div>
);

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p style={{ fontSize: 11, color: 'var(--ff-text-tertiary)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
    <p style={{ fontSize: 14, color: 'var(--ff-text-primary)', margin: 0, fontWeight: 500 }}>{value}</p>
  </div>
);

const ErrorView: React.FC<{ message: string; onRetry: () => void; onBack: () => void }> = ({ message, onRetry, onBack }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: 20, textAlign: 'center' }}>
      <AlertCircle style={{ width: 32, height: 32, color: '#ef4444', margin: '0 auto 10px' }} />
      <p style={{ color: '#ef4444', fontSize: 14 }}>{message}</p>
      <button onClick={onRetry} style={{ marginTop: 10, padding: '8px 16px', border: '1px solid var(--ff-border-light)', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}>Retry</button>
    </div>
    <button onClick={onBack} style={backBtn}><ArrowLeft style={{ width: 16, height: 16 }} /> Back</button>
  </div>
);

const backBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '10px 16px', border: '1px solid var(--ff-border-light)',
  borderRadius: 8, cursor: 'pointer', background: 'transparent',
  color: 'var(--ff-text-secondary)', fontSize: 14,
};

const primaryBtn = (bg: string): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 20px', background: bg, color: '#fff',
  border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14,
});
