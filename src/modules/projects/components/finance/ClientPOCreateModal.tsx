/**
 * Client PO Create Modal
 * Form to create a new Client Purchase Order
 */

import { useState } from 'react';
import type { ClientPOCreateInput } from '@/types/finance';
import { log } from '@/lib/logger';

interface ClientPOCreateModalProps {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function ClientPOCreateModal({ projectId, onClose, onCreated }: ClientPOCreateModalProps) {
  const [formData, setFormData] = useState<Partial<ClientPOCreateInput>>({
    poNumber: '',
    reference: '',
    contractedDrops: 0,
    pricePerDrop: 500,
    poDate: new Date().toISOString().split('T')[0],
    taxRate: 15,
    taxInclusive: false,
    description: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.poNumber?.trim()) {
      setError('PO number is required');
      return;
    }
    if (!formData.contractedDrops || formData.contractedDrops <= 0) {
      setError('Contracted drops must be greater than 0');
      return;
    }
    if (!formData.pricePerDrop || formData.pricePerDrop <= 0) {
      setError('Price per drop must be greater than 0');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/client-pos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.message || 'Failed to create Client PO');
      }

      onCreated();
    } catch (err) {
      log.error('Failed to create Client PO', { projectId, err });
      setError(err instanceof Error ? err.message : 'Failed to create Client PO');
    } finally {
      setLoading(false);
    }
  };

  const totalValue = (formData.contractedDrops || 0) * (formData.pricePerDrop || 0);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-card-bg)] rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[var(--ff-card-bg)] px-6 py-4 border-b border-[var(--ff-border-light)] flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Create Client PO</h2>
          <button
            onClick={onClose}
            className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                PO Number *
              </label>
              <input
                type="text"
                value={formData.poNumber || ''}
                onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="CPO-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Client Reference
              </label>
              <input
                type="text"
                value={formData.reference || ''}
                onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Client's ref"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Contracted Drops *
              </label>
              <input
                type="number"
                value={formData.contractedDrops || ''}
                onChange={(e) => setFormData({ ...formData, contractedDrops: parseInt(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Price per Drop (R) *
              </label>
              <input
                type="number"
                value={formData.pricePerDrop || ''}
                onChange={(e) => setFormData({ ...formData, pricePerDrop: parseFloat(e.target.value) || 0 })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="0.01"
                step="0.01"
              />
            </div>
          </div>

          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--ff-text-secondary)]">Total Contract Value</span>
              <span className="text-xl font-bold text-blue-400">
                R {totalValue.toLocaleString()}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                PO Date *
              </label>
              <input
                type="date"
                value={formData.poDate || ''}
                onChange={(e) => setFormData({ ...formData, poDate: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
                Tax Rate (%)
              </label>
              <input
                type="number"
                value={formData.taxRate ?? 15}
                onChange={(e) => setFormData({ ...formData, taxRate: parseFloat(e.target.value) || 15 })}
                className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min="0"
                max="100"
                step="0.01"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Description
            </label>
            <textarea
              value={formData.description || ''}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              placeholder="Additional details about this PO..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-[var(--ff-border-light)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              )}
              Create Client PO
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
