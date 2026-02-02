/**
 * Invoice Detail Modal
 * Shows detailed view of a customer invoice with line items and actions
 */

import { useState, useEffect } from 'react';
import type { CustomerInvoice, CustomerInvoiceItem } from '@/types/finance';
import { log } from '@/lib/logger';

interface InvoiceDetailModalProps {
  projectId: string;
  invoice: CustomerInvoice;
  onClose: () => void;
  onUpdated: () => void;
}

export function InvoiceDetailModal({ projectId, invoice, onClose, onUpdated }: InvoiceDetailModalProps) {
  const [fullInvoice, setFullInvoice] = useState<CustomerInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(invoice.totalAmount - invoice.amountPaid);
  const [showPayment, setShowPayment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetails() {
      try {
        const response = await fetch(`/api/projects/${projectId}/customer-invoices/${invoice.id}`);
        if (!response.ok) throw new Error('Failed to fetch details');
        const data = await response.json();
        setFullInvoice(data.invoice);
      } catch (err) {
        log.error('Failed to fetch invoice details', { invoiceId: invoice.id, err });
        setError('Failed to load invoice details');
      } finally {
        setLoading(false);
      }
    }
    fetchDetails();
  }, [projectId, invoice.id]);

  const handleAction = async (action: string) => {
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/customer-invoices/${invoice.id}?action=${action}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || `Failed to ${action}`);
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentAmount || paymentAmount <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    setActionLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/customer-invoices/${invoice.id}?action=record-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: paymentAmount }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to record payment');
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setActionLoading(false);
    }
  };

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

  const colors = statusColors[invoice.status] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };
  const outstanding = invoice.totalAmount - invoice.amountPaid;
  const displayInvoice = fullInvoice || invoice;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-card-bg)] rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-card-bg)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">{invoice.invoiceNumber}</h2>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              {invoice.clientPoNumber ? `Client PO: ${invoice.clientPoNumber}` : 'No Client PO'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
              {invoice.status.replace('_', ' ')}
            </span>
            <button
              onClick={onClose}
              className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Subtotal</div>
              <div className="text-xl font-bold text-[var(--ff-text-primary)]">
                R {displayInvoice.subtotal.toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">VAT ({displayInvoice.taxRate}%)</div>
              <div className="text-xl font-bold text-[var(--ff-text-primary)]">
                R {displayInvoice.taxAmount.toLocaleString()}
              </div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Total</div>
              <div className="text-xl font-bold text-blue-400">
                R {displayInvoice.totalAmount.toLocaleString()}
              </div>
            </div>
            <div className={outstanding > 0 ? 'bg-amber-500/10 rounded-lg p-4' : 'bg-green-500/10 rounded-lg p-4'}>
              <div className="text-sm text-[var(--ff-text-secondary)]">Outstanding</div>
              <div className={`text-xl font-bold ${outstanding > 0 ? 'text-amber-400' : 'text-green-400'}`}>
                R {outstanding.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[var(--ff-text-secondary)]">Invoice Date</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(displayInvoice.invoiceDate)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Due Date</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(displayInvoice.dueDate)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Period Start</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(displayInvoice.billingPeriodStart)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Period End</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(displayInvoice.billingPeriodEnd)}</div>
            </div>
          </div>

          {/* Line Items */}
          {loading ? (
            <div className="animate-pulse h-48 bg-[var(--ff-bg-secondary)] rounded-lg" />
          ) : displayInvoice.items && displayInvoice.items.length > 0 ? (
            <div>
              <h4 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                Line Items ({displayInvoice.items.length})
              </h4>
              <div className="max-h-64 overflow-y-auto border border-[var(--ff-border-light)] rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-[var(--ff-bg-secondary)] sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Drop</th>
                      <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Activation Date</th>
                      <th className="px-3 py-2 text-right text-[var(--ff-text-secondary)]">Unit Price</th>
                      <th className="px-3 py-2 text-right text-[var(--ff-text-secondary)]">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ff-border-light)]">
                    {displayInvoice.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2 text-[var(--ff-text-primary)]">{item.dropNumber}</td>
                        <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                          {formatDate(item.activationDate)}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--ff-text-primary)]">
                          R {item.unitPrice.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-[var(--ff-text-primary)]">
                          R {item.lineTotal.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* Payment Recording */}
          {showPayment && outstanding > 0 && (
            <div className="p-4 bg-[var(--ff-bg-secondary)] rounded-lg space-y-3">
              <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">Record Payment</h4>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Amount (R)</label>
                  <input
                    type="number"
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                    max={outstanding}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button
                    onClick={handleRecordPayment}
                    disabled={actionLoading}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg text-sm font-medium"
                  >
                    Record
                  </button>
                  <button
                    onClick={() => setShowPayment(false)}
                    className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-4 border-t border-[var(--ff-border-light)]">
            <div className="flex gap-2">
              {invoice.status === 'draft' && (
                <button
                  onClick={() => handleAction('approve')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg text-sm font-medium"
                >
                  Approve
                </button>
              )}
              {invoice.status === 'approved' && (
                <button
                  onClick={() => handleAction('send')}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white rounded-lg text-sm font-medium"
                >
                  Mark as Sent
                </button>
              )}
              {['sent', 'partially_paid'].includes(invoice.status) && outstanding > 0 && !showPayment && (
                <button
                  onClick={() => setShowPayment(true)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                >
                  Record Payment
                </button>
              )}
              {invoice.status !== 'paid' && invoice.status !== 'cancelled' && (
                <button
                  onClick={() => handleAction('cancel')}
                  disabled={actionLoading}
                  className="px-4 py-2 text-red-400 hover:text-red-300 text-sm"
                >
                  Cancel Invoice
                </button>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
