'use client';

/**
 * Invoice Detail Drawer
 * Shows full invoice detail including line items and allows status transitions.
 * Used on the invoice list page.
 */

import { useState } from 'react';
import {
  X,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { applyInvoiceAction } from '@/services/contractor/contractorInvoicesService';
import type {
  ContractorInvoiceWithDetails,
  ContractorInvoiceAction,
  ContractorInvoiceStatus,
} from '@/types/contractor-invoice.types';
import { log } from '@/lib/logger';

// ==================== Status Badge ====================

const STATUS_CONFIG: Record<
  ContractorInvoiceStatus,
  { label: string; className: string }
> = {
  submitted:    { label: 'Submitted',    className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  under_review: { label: 'Under Review', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  approved:     { label: 'Approved',     className: 'bg-green-500/20 text-green-300 border-green-500/30' },
  paid:         { label: 'Paid',         className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  rejected:     { label: 'Rejected',     className: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

function StatusBadge({ status }: { status: ContractorInvoiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ==================== Action buttons per status ====================

interface ActionDef {
  action: ContractorInvoiceAction;
  label: string;
  className: string;
  icon: React.ReactNode;
}

const ACTIONS_BY_STATUS: Partial<Record<ContractorInvoiceStatus, ActionDef[]>> = {
  submitted: [
    {
      action: 'review',
      label: 'Move to Review',
      className: 'bg-yellow-600 hover:bg-yellow-700 text-white',
      icon: <Clock className="h-4 w-4" />,
    },
  ],
  under_review: [
    {
      action: 'approve',
      label: 'Approve',
      className: 'bg-green-600 hover:bg-green-700 text-white',
      icon: <CheckCircle className="h-4 w-4" />,
    },
    {
      action: 'reject',
      label: 'Reject',
      className: 'bg-red-600 hover:bg-red-700 text-white',
      icon: <XCircle className="h-4 w-4" />,
    },
  ],
  approved: [
    {
      action: 'pay',
      label: 'Mark as Paid',
      className: 'bg-emerald-600 hover:bg-emerald-700 text-white',
      icon: <DollarSign className="h-4 w-4" />,
    },
    {
      action: 'reject',
      label: 'Reject',
      className: 'bg-red-600 hover:bg-red-700 text-white',
      icon: <XCircle className="h-4 w-4" />,
    },
  ],
};

// ==================== Props ====================

interface InvoiceDetailDrawerProps {
  invoice: ContractorInvoiceWithDetails;
  onClose: () => void;
  onUpdated: (updated: ContractorInvoiceWithDetails) => void;
}

// ==================== Component ====================

export function InvoiceDetailDrawer({ invoice, onClose, onUpdated }: InvoiceDetailDrawerProps) {
  const [actioning, setActioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pendingAction, setPendingAction] = useState<ContractorInvoiceAction | null>(null);

  const availableActions = ACTIONS_BY_STATUS[invoice.status] ?? [];

  const handleAction = async (action: ContractorInvoiceAction) => {
    if (action === 'reject' && !rejectReason.trim()) {
      setActionError('Please provide a rejection reason');
      return;
    }

    setActioning(true);
    setActionError(null);

    try {
      const updated = await applyInvoiceAction(invoice.contractorId, invoice.id, {
        action,
        rejectionReason: action === 'reject' ? rejectReason.trim() : undefined,
      });
      onUpdated(updated);
      setPendingAction(null);
      setRejectReason('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      log.error('Failed to apply invoice action', { error: err, invoiceId: invoice.id }, 'InvoiceDetailDrawer');
      setActionError(message);
    } finally {
      setActioning(false);
    }
  };

  const fmt = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;
  const dateStr = (d: Date) => new Date(d).toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div className="relative w-full max-w-xl bg-[var(--ff-bg-primary)] border-l border-[var(--ff-border-light)] shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)] shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-[var(--ff-text-secondary)]" />
            <div>
              <h2 className="text-base font-bold text-[var(--ff-text-primary)]">
                Invoice #{invoice.invoiceNumber}
              </h2>
              <p className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
                Created {dateStr(invoice.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={invoice.status} />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Project link */}
          {invoice.projectName && (
            <div className="flex items-center gap-2 text-sm text-[var(--ff-text-secondary)]">
              <ChevronRight className="h-4 w-4" />
              <span>{invoice.projectName}</span>
              {invoice.projectCode && (
                <span className="text-[var(--ff-text-tertiary)]">({invoice.projectCode})</span>
              )}
              {invoice.role && (
                <span className="text-[var(--ff-text-tertiary)]"> — {invoice.role}</span>
              )}
            </div>
          )}

          {/* Line items table */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-3">Line Items</h3>
            <div className="overflow-x-auto rounded-lg border border-[var(--ff-border-light)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] text-xs">
                    <th className="text-left px-4 py-2.5 font-medium">Description</th>
                    <th className="text-right px-4 py-2.5 font-medium">Qty</th>
                    <th className="text-right px-4 py-2.5 font-medium">Unit Price</th>
                    <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ff-border-light)]">
                  {invoice.lineItems.map((item, i) => (
                    <tr key={i} className="bg-[var(--ff-bg-secondary)]">
                      <td className="px-4 py-3 text-[var(--ff-text-primary)]">{item.description}</td>
                      <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">
                        {item.quantity.toLocaleString('en-ZA')}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">
                        {fmt(item.unit_price)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-[var(--ff-text-primary)]">
                        {fmt(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)]">
                    <td colSpan={3} className="px-4 py-3 text-right font-semibold text-[var(--ff-text-primary)] text-sm">
                      Total
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-[var(--ff-text-primary)]">
                      {fmt(invoice.totalAmount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-1">Notes</h3>
              <p className="text-sm text-[var(--ff-text-secondary)] italic">{invoice.notes}</p>
            </div>
          )}

          {/* Rejection reason (shown if rejected) */}
          {invoice.status === 'rejected' && invoice.rejectionReason && (
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-300 mb-1">Rejection Reason</p>
                  <p className="text-sm text-red-200">{invoice.rejectionReason}</p>
                </div>
              </div>
            </div>
          )}

          {/* Status history (simple breadcrumb) */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--ff-text-primary)] mb-2">Status</h3>
            <StatusBadge status={invoice.status} />
            <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
              Last updated: {dateStr(invoice.updatedAt)}
            </p>
          </div>

          {/* Action error */}
          {actionError && (
            <div className="flex items-center gap-2 text-red-400 text-sm p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{actionError}</span>
            </div>
          )}

          {/* Rejection reason input (shown when reject is pending) */}
          {pendingAction === 'reject' && (
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10">
              <label className="block text-sm font-medium text-red-300 mb-2">
                Rejection Reason <span className="text-red-400">*</span>
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border border-red-500/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm resize-none"
                placeholder="Explain why this invoice is being rejected..."
              />
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => handleAction('reject')}
                  disabled={actioning || !rejectReason.trim()}
                  className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actioning ? 'Rejecting...' : 'Confirm Reject'}
                </button>
                <button
                  onClick={() => { setPendingAction(null); setRejectReason(''); setActionError(null); }}
                  className="px-4 py-2 text-sm text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        {availableActions.length > 0 && pendingAction !== 'reject' && (
          <div className="shrink-0 px-6 py-4 border-t border-[var(--ff-border-light)] flex flex-wrap items-center gap-2 bg-[var(--ff-bg-secondary)]">
            {availableActions.map((def) => (
              <button
                key={def.action}
                onClick={() => {
                  if (def.action === 'reject') {
                    setPendingAction('reject');
                    setActionError(null);
                  } else {
                    handleAction(def.action);
                  }
                }}
                disabled={actioning}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${def.className}`}
              >
                {def.icon}
                {actioning && def.action !== 'reject' ? 'Processing...' : def.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
