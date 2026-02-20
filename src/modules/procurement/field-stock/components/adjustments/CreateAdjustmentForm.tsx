/**
 * CreateAdjustmentForm
 * Modal form for creating a stock quantity adjustment
 */

import { useState } from 'react';
import { X, Loader2, Plus, Minus } from 'lucide-react';
import { useLocations, useStockItems } from '../../hooks';
import type { AdjustmentReason } from '@/types/procurement/stockTake.types';
import { notificationService } from '@/services/core/NotificationService';
import { log } from '@/lib/logger';

interface CreateAdjustmentFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: {
    stock_item_id: string;
    location_id: string;
    adjustment_type: 'increase' | 'decrease';
    quantity: number;
    reason_code: string;
    notes?: string;
  }) => Promise<void>;
  reasons: AdjustmentReason[];
}

export function CreateAdjustmentForm({ isOpen, onClose, onSubmit, reasons }: CreateAdjustmentFormProps) {
  const { locations } = useLocations({ autoFetch: true });
  const { items: stockItems } = useStockItems({ autoFetch: true });

  const [formData, setFormData] = useState({
    stock_item_id: '',
    location_id: '',
    adjustment_type: 'decrease' as 'increase' | 'decrease',
    quantity: '',
    reason_code: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [locationSearch, setLocationSearch] = useState('');

  if (!isOpen) return null;

  const filteredItems = stockItems.filter(
    (i) =>
      i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
      i.itemCode.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const filteredLocations = locations.filter(
    (l) =>
      ['warehouse', 'technician', 'site'].includes(l.locationType) &&
      (l.name.toLowerCase().includes(locationSearch.toLowerCase()) ||
        l.code.toLowerCase().includes(locationSearch.toLowerCase()))
  );

  const handleSubmit = async () => {
    if (!formData.stock_item_id) {
      notificationService.error('Select a stock item');
      return;
    }
    if (!formData.location_id) {
      notificationService.error('Select a location');
      return;
    }
    if (!formData.quantity || parseFloat(formData.quantity) <= 0) {
      notificationService.error('Enter a valid quantity');
      return;
    }
    if (!formData.reason_code) {
      notificationService.error('Select a reason');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        stock_item_id: formData.stock_item_id,
        location_id: formData.location_id,
        adjustment_type: formData.adjustment_type,
        quantity: parseFloat(formData.quantity),
        reason_code: formData.reason_code,
        notes: formData.notes || undefined,
      });
      notificationService.success('Adjustment created');
      setFormData({
        stock_item_id: '',
        location_id: '',
        adjustment_type: 'decrease',
        quantity: '',
        reason_code: '',
        notes: '',
      });
      setItemSearch('');
      setLocationSearch('');
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create adjustment';
      notificationService.error(message);
      log.error('Failed to create adjustment', err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-[var(--ff-bg-secondary)] rounded-lg shadow-xl w-full max-w-lg p-6 border border-[var(--ff-border-light)] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">New Stock Adjustment</h2>
          <button onClick={onClose} className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Location *</label>
            <input
              type="text"
              placeholder="Search locations..."
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
              className="w-full px-3 py-2 mb-1 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] text-sm"
            />
            <select
              value={formData.location_id}
              onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="">Select location</option>
              {filteredLocations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name} ({loc.code})
                </option>
              ))}
            </select>
          </div>

          {/* Stock Item */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Stock Item *</label>
            <input
              type="text"
              placeholder="Search items..."
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              className="w-full px-3 py-2 mb-1 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] text-sm"
            />
            <select
              value={formData.stock_item_id}
              onChange={(e) => setFormData({ ...formData, stock_item_id: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="">Select item</option>
              {filteredItems.slice(0, 100).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.itemCode} - {item.name}
                </option>
              ))}
            </select>
          </div>

          {/* Adjustment Type Toggle */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Adjustment Type *</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, adjustment_type: 'decrease' })}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  formData.adjustment_type === 'decrease'
                    ? 'bg-red-500/20 border-red-500/50 text-red-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-red-500/30'
                }`}
              >
                <Minus className="h-4 w-4" />
                Decrease
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, adjustment_type: 'increase' })}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  formData.adjustment_type === 'increase'
                    ? 'bg-green-500/20 border-green-500/50 text-green-400'
                    : 'bg-[var(--ff-bg-tertiary)] border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:border-green-500/30'
                }`}
              >
                <Plus className="h-4 w-4" />
                Increase
              </button>
            </div>
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Quantity *</label>
            <input
              type="number"
              min="0.001"
              step="0.001"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
              placeholder="Enter quantity"
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)]"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Reason *</label>
            <select
              value={formData.reason_code}
              onChange={(e) => setFormData({ ...formData, reason_code: e.target.value })}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="">Select reason</option>
              {reasons.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">Notes</label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Optional notes about this adjustment"
              rows={3}
              className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white transition-colors disabled:opacity-50 ${
              formData.adjustment_type === 'decrease'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                {formData.adjustment_type === 'decrease' ? (
                  <Minus className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create Adjustment
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
