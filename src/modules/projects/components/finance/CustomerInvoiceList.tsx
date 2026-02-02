/**
 * Customer Invoice List Component
 * Displays a list of customer invoices with status and actions
 */

import { useState } from 'react';
import type { CustomerInvoice, CustomerInvoiceSummary } from '@/types/finance';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { log } from '@/lib/logger';

interface CustomerInvoiceListProps {
  projectId: string;
  invoices: CustomerInvoice[];
  summary: CustomerInvoiceSummary | null;
  onRefresh: () => void;
}

export function CustomerInvoiceList({ projectId, invoices, summary, onRefresh }: CustomerInvoiceListProps) {
  const [selectedInvoice, setSelectedInvoice] = useState<CustomerInvoice | null>(null);

  const formatDate = (dateStr: string | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const statusColors: Record<string, { bg: string; text: string }> = {
    draft: { bg: 'bg-gray-500/20', text: 'text-gray-400' },
    pending_approval: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
    approved: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    sent: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
    paid: { bg: 'bg-green-500/20', text: 'text-green-400' },
    partially_paid: { bg: 'bg-teal-500/20', text: 'text-teal-400' },
    overdue: { bg: 'bg-red-500/20', text: 'text-red-400' },
    cancelled: { bg: 'bg-gray-500/20', text: 'text-gray-500' },
  };

  const handleAction = async (invoiceId: string, action: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/customer-invoices/${invoiceId}?action=${action}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Action failed');
      }
      onRefresh();
    } catch (error) {
      log.error('Invoice action failed', { invoiceId, action, error });
    }
  };

  if (invoices.length === 0) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-2">No Invoices Yet</h3>
        <p className="text-[var(--ff-text-secondary)] max-w-md mx-auto">
          Generate an invoice from activated drops to start billing your client.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)]">
              <th className="px-4 py-3 font-medium">Invoice #</th>
              <th className="px-4 py-3 font-medium">Period</th>
              <th className="px-4 py-3 font-medium">Client PO</th>
              <th className="px-4 py-3 font-medium text-right">Amount</th>
              <th className="px-4 py-3 font-medium text-right">Paid</th>
              <th className="px-4 py-3 font-medium text-center">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {invoices.map((invoice) => {
              const colors = statusColors[invoice.status] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };
              const outstanding = invoice.totalAmount - invoice.amountPaid;

              return (
                <tr key={invoice.id} className="hover:bg-[var(--ff-bg-secondary)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--ff-text-primary)]">{invoice.invoiceNumber}</div>
                    <div className="text-xs text-[var(--ff-text-secondary)]">
                      {formatDate(invoice.invoiceDate)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      {formatDate(invoice.billingPeriodStart)} - {formatDate(invoice.billingPeriodEnd)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-[var(--ff-text-secondary)]">
                      {invoice.clientPoNumber || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm font-medium text-[var(--ff-text-primary)]">
                      R {invoice.totalAmount.toLocaleString()}
                    </div>
                    <div className="text-xs text-[var(--ff-text-secondary)]">
                      excl. R {invoice.taxAmount.toLocaleString()} VAT
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm text-[var(--ff-text-primary)]">
                      R {invoice.amountPaid.toLocaleString()}
                    </div>
                    {outstanding > 0 && invoice.status !== 'draft' && (
                      <div className="text-xs text-amber-400">
                        R {outstanding.toLocaleString()} due
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                      {invoice.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedInvoice(invoice)}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        View
                      </button>
                      {invoice.status === 'draft' && (
                        <button
                          onClick={() => handleAction(invoice.id, 'approve')}
                          className="text-green-400 hover:text-green-300 text-sm"
                        >
                          Approve
                        </button>
                      )}
                      {invoice.status === 'approved' && (
                        <button
                          onClick={() => handleAction(invoice.id, 'send')}
                          className="text-purple-400 hover:text-purple-300 text-sm"
                        >
                          Send
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedInvoice && (
        <InvoiceDetailModal
          projectId={projectId}
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
          onUpdated={() => {
            setSelectedInvoice(null);
            onRefresh();
          }}
        />
      )}
    </>
  );
}
