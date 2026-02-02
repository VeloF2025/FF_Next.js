/**
 * Client PO Detail Modal
 * Shows detailed view of a Client Purchase Order with actions
 */

import { useState, useEffect } from 'react';
import type { ClientPurchaseOrder, ClientPOProgress } from '@/types/finance';
import { log } from '@/lib/logger';

interface ClientPODetailModalProps {
  projectId: string;
  clientPO: ClientPurchaseOrder;
  onClose: () => void;
  onUpdated: () => void;
}

export function ClientPODetailModal({ projectId, clientPO, onClose, onUpdated }: ClientPODetailModalProps) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<ClientPOProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDetails() {
      try {
        const response = await fetch(`/api/projects/${projectId}/client-pos/${clientPO.id}`);
        if (!response.ok) throw new Error('Failed to fetch details');
        const data = await response.json();
        setProgress(data.progress);
      } catch (err) {
        log.error('Failed to fetch Client PO details', { clientPoId: clientPO.id, err });
      }
    }
    fetchDetails();
  }, [projectId, clientPO.id]);

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/client-pos/${clientPO.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to activate');
      }
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate');
    } finally {
      setLoading(false);
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
    active: { bg: 'bg-green-500/20', text: 'text-green-400' },
    completed: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    cancelled: { bg: 'bg-red-500/20', text: 'text-red-400' },
  };

  const colors = statusColors[clientPO.status] ?? { bg: 'bg-gray-500/20', text: 'text-gray-400' };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-card-bg)] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-card-bg)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">{clientPO.poNumber}</h2>
            {clientPO.reference && (
              <p className="text-sm text-[var(--ff-text-secondary)]">{clientPO.reference}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 rounded-full text-xs font-medium ${colors.bg} ${colors.text} capitalize`}>
              {clientPO.status}
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

          {/* Contract Details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Contracted Drops</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {clientPO.contractedDrops.toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Price per Drop</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                R {clientPO.pricePerDrop.toLocaleString()}
              </div>
            </div>
            <div className="bg-blue-500/10 rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Total Contract Value</div>
              <div className="text-2xl font-bold text-blue-400">
                R {clientPO.totalValue.toLocaleString()}
              </div>
            </div>
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
              <div className="text-sm text-[var(--ff-text-secondary)]">Tax Rate</div>
              <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                {clientPO.taxRate}%
              </div>
            </div>
          </div>

          {/* Progress */}
          {progress && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-[var(--ff-text-secondary)]">Progress</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--ff-text-secondary)]">Drops Activated</span>
                    <span className="text-[var(--ff-text-primary)]">{progress.activatedPercent}%</span>
                  </div>
                  <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500"
                      style={{ width: `${Math.min(progress.activatedPercent, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    {clientPO.dropsActivated} / {clientPO.contractedDrops}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-[var(--ff-text-secondary)]">Amount Invoiced</span>
                    <span className="text-[var(--ff-text-primary)]">{progress.invoicedPercent}%</span>
                  </div>
                  <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500"
                      style={{ width: `${Math.min(progress.invoicedPercent, 100)}%` }}
                    />
                  </div>
                  <div className="text-xs text-[var(--ff-text-secondary)] mt-1">
                    R {clientPO.amountInvoiced.toLocaleString()} / R {clientPO.totalValue.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="flex justify-between p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
                <span className="text-sm text-[var(--ff-text-secondary)]">Remaining to Invoice</span>
                <span className="text-sm font-medium text-amber-400">
                  R {progress.remainingValue.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[var(--ff-text-secondary)]">PO Date</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(clientPO.poDate)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Valid From</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(clientPO.validFrom)}</div>
            </div>
            <div>
              <div className="text-[var(--ff-text-secondary)]">Valid To</div>
              <div className="text-[var(--ff-text-primary)]">{formatDate(clientPO.validTo)}</div>
            </div>
          </div>

          {clientPO.description && (
            <div>
              <div className="text-sm text-[var(--ff-text-secondary)] mb-1">Description</div>
              <div className="text-sm text-[var(--ff-text-primary)] p-3 bg-[var(--ff-bg-secondary)] rounded-lg">
                {clientPO.description}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            {clientPO.status === 'draft' && (
              <button
                onClick={handleActivate}
                disabled={loading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg font-medium transition-colors"
              >
                {loading ? 'Activating...' : 'Activate PO'}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
