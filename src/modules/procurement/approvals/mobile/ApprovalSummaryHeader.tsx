import { AlertTriangle, Clock } from 'lucide-react';
import type { ApprovalRequestRecord } from './types';

const TYPE_LABELS: Record<string, string> = {
  purchase_order: 'Purchase Order', purchase_requisition: 'Requisition', boq: 'BOQ',
  rfq: 'RFQ', goods_receipt: 'Goods Receipt', supplier_registration: 'Supplier Registration',
  payment_request: 'Payment Request',
};

function money(v: number | null) {
  if (v == null) return '—';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(v);
}

export function ApprovalSummaryHeader({ record }: { record: ApprovalRequestRecord }) {
  return (
    <section className="p-4 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400">
          {TYPE_LABELS[record.documentType] ?? record.documentType}
        </span>
        {record.isOverdue && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-300">
            <AlertTriangle className="h-3 w-3" /> Overdue
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="min-w-0 text-lg font-semibold text-[var(--ff-text-primary)] truncate">{record.documentNumber || '—'}</h2>
        <span className="text-lg font-semibold text-[var(--ff-text-primary)] shrink-0">{money(record.documentAmount)}</span>
      </div>
      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between gap-3"><dt className="shrink-0 text-[var(--ff-text-tertiary)]">Requested by</dt>
          <dd className="min-w-0 text-right text-[var(--ff-text-secondary)] truncate">{record.requestedByName || '—'}</dd></div>
        <div className="flex justify-between gap-3"><dt className="shrink-0 text-[var(--ff-text-tertiary)]">Level</dt>
          <dd className="min-w-0 text-right text-[var(--ff-text-secondary)] truncate">{record.levelName || `Level ${record.levelNumber ?? ''}`}</dd></div>
        {record.requestNotes && (
          <div className="pt-1 text-[var(--ff-text-secondary)] flex items-start gap-1.5">
            <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--ff-text-tertiary)]" />
            <span className="whitespace-pre-wrap">{record.requestNotes}</span>
          </div>
        )}
      </dl>
    </section>
  );
}
