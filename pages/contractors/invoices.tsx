/**
 * Contractor Invoices List Page
 * /contractors/invoices
 *
 * Cross-contractor invoice list with filtering by contractor and status.
 * Opens an invoice detail drawer on row click.
 */

import type { NextPage } from 'next';
import React, { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { FileText, Plus, AlertCircle, Filter } from 'lucide-react';
import { getContractorInvoices, createContractorInvoice } from '@/services/contractor/contractorInvoicesService';
import { InvoiceDetailDrawer } from '@/components/contractors/InvoiceDetailDrawer';
import { CreateInvoiceModal } from '@/components/contractors/CreateInvoiceModal';
import type {
  ContractorInvoiceWithDetails,
  ContractorInvoiceStatus,
} from '@/types/contractor-invoice.types';
import { CONTRACTOR_INVOICE_STATUSES } from '@/types/contractor-invoice.types';
import { log } from '@/lib/logger';

// ==================== Status badge (inline) ====================

const STATUS_LABEL: Record<ContractorInvoiceStatus, string> = {
  submitted:    'Submitted',
  under_review: 'Under Review',
  approved:     'Approved',
  paid:         'Paid',
  rejected:     'Rejected',
};

const STATUS_CLASS: Record<ContractorInvoiceStatus, string> = {
  submitted:    'bg-blue-500/20 text-blue-300 border-blue-500/30',
  under_review: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  approved:     'bg-green-500/20 text-green-300 border-green-500/30',
  paid:         'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  rejected:     'bg-red-500/20 text-red-300 border-red-500/30',
};

function StatusBadge({ status }: { status: ContractorInvoiceStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ==================== Minimal contractor type for filter dropdown ====================

interface ContractorOption {
  id: string;
  company_name: string;
}

// ==================== Page ====================

const ContractorInvoicesPage: NextPage = () => {
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
  const [selectedContractorId, setSelectedContractorId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<ContractorInvoiceStatus | ''>('');
  const [invoices, setInvoices] = useState<ContractorInvoiceWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<ContractorInvoiceWithDetails | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Load contractor options on mount
  useEffect(() => {
    fetch('/api/contractors', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const json = await r.json();
        // The contractors endpoint returns { data: [...] } or just an array
        const list: ContractorOption[] = Array.isArray(json)
          ? json
          : Array.isArray(json.data)
          ? json.data
          : [];
        setContractors(list.sort((a, b) => a.company_name.localeCompare(b.company_name)));
      })
      .catch((err: unknown) => {
        log.error('Failed to load contractors for filter', { error: err }, 'ContractorInvoicesPage');
      });
  }, []);

  const loadInvoices = useCallback(async () => {
    if (!selectedContractorId) {
      setInvoices([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await getContractorInvoices({
        contractorId: selectedContractorId,
        status: statusFilter || undefined,
      });
      setInvoices(result.data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load invoices';
      log.error('Error loading invoices', { error: err, contractorId: selectedContractorId }, 'ContractorInvoicesPage');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [selectedContractorId, statusFilter]);

  useEffect(() => {
    loadInvoices();
  }, [loadInvoices]);

  const handleInvoiceUpdated = (updated: ContractorInvoiceWithDetails) => {
    setInvoices((prev) => prev.map((inv) => (inv.id === updated.id ? updated : inv)));
    setSelectedInvoice(updated);
  };

  const fmt = (n: number) =>
    `R ${n.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`;

  const dateStr = (d: Date) => new Date(d).toISOString().split('T')[0];

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
              <FileText className="h-6 w-6" />
              Contractor Invoices
            </h1>
            <p className="text-sm text-[var(--ff-text-secondary)] mt-1">
              Manage invoice and progress claim lifecycle
            </p>
          </div>
          {selectedContractorId && (
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus className="h-4 w-4" />
              New Invoice
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6 p-4 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
          <Filter className="h-4 w-4 text-[var(--ff-text-secondary)]" />

          {/* Contractor selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ff-text-secondary)] whitespace-nowrap">Contractor</label>
            <select
              value={selectedContractorId}
              onChange={(e) => setSelectedContractorId(e.target.value)}
              className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px]"
            >
              <option value="">— Select a contractor —</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--ff-text-secondary)] whitespace-nowrap">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ContractorInvoiceStatus | '')}
              className="px-3 py-1.5 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All statuses</option>
              {CONTRACTOR_INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          {statusFilter && (
            <button
              onClick={() => setStatusFilter('')}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              Clear filter
            </button>
          )}
        </div>

        {/* Content */}
        {!selectedContractorId ? (
          <div className="text-center py-20 text-[var(--ff-text-tertiary)]">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-base">Select a contractor to view invoices</p>
          </div>
        ) : loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 bg-[var(--ff-bg-secondary)] rounded-lg animate-pulse border border-[var(--ff-border-light)]" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-red-400 p-4 bg-red-500/10 rounded-lg border border-red-500/30">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-20 text-[var(--ff-text-tertiary)]">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="text-base">No invoices found</p>
            <p className="text-sm mt-1">
              {statusFilter
                ? `No invoices with status "${STATUS_LABEL[statusFilter as ContractorInvoiceStatus]}"`
                : 'Click "New Invoice" to submit the first one'}
            </p>
          </div>
        ) : (
          <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
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

            {/* Footer summary */}
            <div className="px-4 py-3 border-t border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] flex items-center justify-between text-sm">
              <span className="text-[var(--ff-text-secondary)]">
                {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
              </span>
              <span className="text-[var(--ff-text-secondary)]">
                Total:{' '}
                <span className="font-semibold text-[var(--ff-text-primary)]">
                  {fmt(invoices.reduce((s, inv) => s + inv.totalAmount, 0))}
                </span>
              </span>
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
      {showCreate && selectedContractorId && (
        <CreateInvoiceModal
          contractorId={selectedContractorId}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setInvoices((prev) => [created, ...prev]);
            setShowCreate(false);
            setSelectedInvoice(created);
          }}
        />
      )}
    </AppLayout>
  );
};

export default ContractorInvoicesPage;
