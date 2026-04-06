'use client';

/**
 * Invoice Section
 * Displays contractor invoices with status badges and allows creating new invoices.
 * Opens an inline detail drawer on row click.
 * Used on the contractor detail page.
 */

import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, AlertCircle } from 'lucide-react';
import { getContractorInvoices } from '@/services/contractor/contractorInvoicesService';
import { InvoiceDetailDrawer } from './InvoiceDetailDrawer';
import { CreateInvoiceModal } from './CreateInvoiceModal';
import type {
  ContractorInvoiceWithDetails,
  ContractorInvoiceStatus,
} from '@/types/contractor-invoice.types';
import { CONTRACTOR_INVOICE_STATUSES } from '@/types/contractor-invoice.types';
import { log } from '@/lib/logger';

// ==================== Status badge ====================

const STATUS_CONFIG: Record<ContractorInvoiceStatus, { label: string; className: string }> = {
  submitted:    { label: 'Submitted',    className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  under_review: { label: 'Under Review', className: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
  approved:     { label: 'Approved',     className: 'bg-green-500/20 text-green-300 border-green-500/30' },
  paid:         { label: 'Paid',         className: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  rejected:     { label: 'Rejected',     className: 'bg-red-500/20 text-red-300 border-red-500/30' },
};

function StatusBadge({ status }: { status: ContractorInvoiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

// ==================== Formatting helpers ====================

const fmt = (n: number) => `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;
const dateStr = (d: Date) => new Date(d).toISOString().split('T')[0];

// ==================== Props ====================

interface InvoiceSectionProps {
  contractorId: string;
}

// ==================== Component ====================

export function InvoiceSection({ contractorId }: InvoiceSectionProps) {
  const [invoices, setInvoices] = useState<ContractorInvoiceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<ContractorInvoiceStatus | ''>('');
  const [selectedInvoice, setSelectedInvoice] = useState<ContractorInvoiceWithDetails | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getContractorInvoices({
        contractorId,
        status: statusFilter || undefined,
      });
      setInvoices(result.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load invoices';
      log.error('Error loading contractor invoices', { error: err, contractorId }, 'InvoiceSection');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [contractorId, statusFilter]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleInvoiceUpdated = (updated: ContractorInvoiceWithDetails) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
    setSelectedInvoice(updated);
  };

  const handleInvoiceCreated = (created: ContractorInvoiceWithDetails) => {
    setInvoices((prev) => [created, ...prev]);
    setShowCreate(false);
    setSelectedInvoice(created);
  };

  const totalAmount = invoices.reduce((s, inv) => s + inv.totalAmount, 0);
  const paidTotal = invoices.filter(inv => inv.status === 'paid').reduce((s, inv) => s + inv.totalAmount, 0);

  return (
    <>
      <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoices
            </h2>
            {!loading && !error && (
              <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
                {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
                {invoices.length > 0 && (
                  <>
                    {' '}&mdash; Total:{' '}
                    <span className="font-semibold text-[var(--ff-text-primary)]">{fmt(totalAmount)}</span>
                    {paidTotal > 0 && (
                      <> &mdash; Paid:{' '}
                        <span className="font-semibold text-emerald-400">{fmt(paidTotal)}</span>
                      </>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus className="h-4 w-4" />
            New Invoice
          </button>
        </div>

        {/* Status filter */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-[var(--ff-text-secondary)]">Filter:</span>
          <button
            onClick={() => setStatusFilter('')}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              statusFilter === ''
                ? 'bg-[var(--ff-text-secondary)] text-[var(--ff-bg-primary)] border-transparent'
                : 'text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
            }`}
          >
            All
          </button>
          {CONTRACTOR_INVOICE_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                statusFilter === s
                  ? `${STATUS_CONFIG[s].className} font-medium`
                  : 'text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              }`}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-[var(--ff-bg-tertiary)] rounded-lg animate-pulse border border-[var(--ff-border-light)]" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-400 p-4 bg-red-500/10 rounded-lg border border-red-500/30">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No invoices found</p>
            <p className="text-sm mt-1">
              {statusFilter
                ? `No invoices with status "${STATUS_CONFIG[statusFilter as ContractorInvoiceStatus].label}"`
                : 'Click "New Invoice" to create the first invoice'}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2.5 bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)] text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wide">
              <span>Invoice</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
              <span>Date</span>
            </div>

            {/* Rows */}
            <div className="divide-y divide-[var(--ff-border-light)]">
              {invoices.map((inv) => (
                <button
                  key={inv.id}
                  onClick={() => setSelectedInvoice(inv)}
                  className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3.5 text-left hover:bg-[var(--ff-bg-tertiary)] transition-colors items-center"
                >
                  <div>
                    <div className="font-medium text-[var(--ff-text-primary)] text-sm">
                      #{inv.invoiceNumber}
                    </div>
                    {inv.projectName && (
                      <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5">
                        {inv.projectName}
                        {inv.projectCode ? ` (${inv.projectCode})` : ''}
                        {inv.role ? ` — ${inv.role}` : ''}
                      </div>
                    )}
                    {inv.notes && (
                      <div className="text-xs text-[var(--ff-text-tertiary)] mt-0.5 italic truncate max-w-xs">
                        {inv.notes}
                      </div>
                    )}
                  </div>
                  <div className="text-right font-semibold text-[var(--ff-text-primary)] text-sm whitespace-nowrap">
                    {fmt(inv.totalAmount)}
                  </div>
                  <div>
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap">
                    {dateStr(inv.createdAt)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Invoice Detail Drawer */}
      {selectedInvoice && (
        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdated={handleInvoiceUpdated}
        />
      )}

      {/* Create Invoice Modal */}
      {showCreate && (
        <CreateInvoiceModal
          contractorId={contractorId}
          onClose={() => setShowCreate(false)}
          onCreated={handleInvoiceCreated}
        />
      )}
    </>
  );
}
