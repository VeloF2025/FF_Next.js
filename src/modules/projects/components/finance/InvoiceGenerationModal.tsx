/**
 * Invoice Generation Modal
 * Wizard to generate customer invoices from activated drops
 */

import { useState, useEffect } from 'react';
import type { ClientPurchaseOrder, GenerateInvoicePreview, UninvoicedDrop } from '@/types/finance';
import { log } from '@/lib/logger';

interface InvoiceGenerationModalProps {
  projectId: string;
  clientPOs: ClientPurchaseOrder[];
  onClose: () => void;
  onGenerated: () => void;
}

export function InvoiceGenerationModal({
  projectId,
  clientPOs,
  onClose,
  onGenerated,
}: InvoiceGenerationModalProps) {
  const [step, setStep] = useState<'select' | 'preview' | 'generating'>('select');
  const [selectedPO, setSelectedPO] = useState<string>('');
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0] || '';
  });
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0] || '');
  const [preview, setPreview] = useState<GenerateInvoicePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePreview = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (selectedPO) params.append('clientPoId', selectedPO);
      if (startDate) params.append('startDate', startDate);
      if (endDate) params.append('endDate', endDate);

      const response = await fetch(`/api/projects/${projectId}/customer-invoices/generate?${params}`);
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to preview');
      }
      const data = await response.json();
      setPreview(data.preview);
      setStep('preview');
    } catch (err) {
      log.error('Failed to preview invoice', { projectId, err });
      setError(err instanceof Error ? err.message : 'Failed to preview');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setStep('generating');
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/customer-invoices/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientPoId: selectedPO || undefined,
          billingPeriodStart: startDate,
          billingPeriodEnd: endDate,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to generate invoice');
      }

      onGenerated();
    } catch (err) {
      log.error('Failed to generate invoice', { projectId, err });
      setError(err instanceof Error ? err.message : 'Failed to generate invoice');
      setStep('preview');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-card-bg)] rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-card-bg)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Generate Invoice</h2>
          <button
            onClick={onClose}
            className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {step === 'select' && (
            <div className="space-y-4">
              <p className="text-[var(--ff-text-secondary)]">
                Select a billing period to generate an invoice from activated drops.
              </p>

              <div>
                <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                  Client PO (optional)
                </label>
                <select
                  value={selectedPO}
                  onChange={(e) => setSelectedPO(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Client POs</option>
                  {clientPOs.map((po) => (
                    <option key={po.id} value={po.id}>
                      {po.poNumber} - R{po.pricePerDrop}/drop
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Period Start *
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                    Period End *
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePreview}
                  disabled={loading || !startDate || !endDate}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors"
                >
                  {loading ? 'Loading...' : 'Preview'}
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && preview && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
                  <div className="text-sm text-[var(--ff-text-secondary)]">Drops to Invoice</div>
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {preview.drops.length}
                  </div>
                </div>
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4">
                  <div className="text-sm text-[var(--ff-text-secondary)]">Subtotal</div>
                  <div className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    R {preview.subtotal.toLocaleString()}
                  </div>
                </div>
                <div className="bg-green-500/10 rounded-lg p-4">
                  <div className="text-sm text-[var(--ff-text-secondary)]">Total (incl. VAT)</div>
                  <div className="text-2xl font-bold text-green-400">
                    R {preview.totalAmount.toLocaleString()}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">
                  Drops ({preview.drops.length})
                </h4>
                <div className="max-h-48 overflow-y-auto border border-[var(--ff-border-light)] rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-[var(--ff-bg-secondary)] sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Drop #</th>
                        <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">LID</th>
                        <th className="px-3 py-2 text-left text-[var(--ff-text-secondary)]">Activated</th>
                        <th className="px-3 py-2 text-right text-[var(--ff-text-secondary)]">Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ff-border-light)]">
                      {preview.drops.slice(0, 50).map((drop) => (
                        <tr key={drop.dropId}>
                          <td className="px-3 py-2 text-[var(--ff-text-primary)]">{drop.dropNumber}</td>
                          <td className="px-3 py-2 text-[var(--ff-text-secondary)]">{drop.lid || '-'}</td>
                          <td className="px-3 py-2 text-[var(--ff-text-secondary)]">
                            {new Date(drop.activationDate).toLocaleDateString('en-ZA')}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--ff-text-primary)]">
                            R {drop.pricePerDrop.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.drops.length > 50 && (
                    <div className="px-3 py-2 text-center text-sm text-[var(--ff-text-secondary)] bg-[var(--ff-bg-secondary)]">
                      ... and {preview.drops.length - 50} more
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-between items-center pt-4 border-t border-[var(--ff-border-light)]">
                <button
                  onClick={() => setStep('select')}
                  className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
                >
                  Back
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={preview.drops.length === 0}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-green-600/50 text-white rounded-lg font-medium transition-colors"
                >
                  Generate Invoice
                </button>
              </div>
            </div>
          )}

          {step === 'generating' && (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-4 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <p className="text-[var(--ff-text-secondary)]">Generating invoice...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
