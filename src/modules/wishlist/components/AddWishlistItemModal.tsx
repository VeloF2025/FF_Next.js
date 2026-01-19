/**
 * Add Wishlist Item Modal Component
 */

import { useState } from 'react';
import { X } from 'lucide-react';
import type { CreateWishlistItemInput, WishlistPriority, WishlistEffort } from '../types/wishlist';

interface AddWishlistItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateWishlistItemInput) => Promise<any>;
}

export function AddWishlistItemModal({ isOpen, onClose, onSubmit }: AddWishlistItemModalProps) {
  const [formData, setFormData] = useState<CreateWishlistItemInput>({
    title: '',
    description: '',
    priority: 'medium',
    effort_estimate: undefined,
    business_value: undefined,
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    setSubmitting(true);
    try {
      await onSubmit(formData);
      // Reset form and close modal
      setFormData({
        title: '',
        description: '',
        priority: 'medium',
        effort_estimate: undefined,
        business_value: undefined,
      });
      onClose();
    } catch (error) {
      // Error is handled by the hook
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl max-w-md w-full mx-4">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--ff-border-light)]">
          <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
            Add Wishlist Item
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
              placeholder="Brief title for the feature"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
              placeholder="Detailed description of the feature and its benefits"
              rows={3}
            />
          </div>

          {/* Priority and Effort */}
          <div className="grid grid-cols-2 gap-4">
            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Priority
              </label>
              <select
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as WishlistPriority })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            {/* Effort Estimate */}
            <div>
              <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
                Effort Estimate
              </label>
              <select
                value={formData.effort_estimate || ''}
                onChange={(e) => setFormData({ ...formData, effort_estimate: (e.target.value || undefined) as WishlistEffort })}
                className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
              >
                <option value="">Not estimated</option>
                <option value="XS">XS (1-2 hours)</option>
                <option value="S">S (Half day)</option>
                <option value="M">M (1-2 days)</option>
                <option value="L">L (3-5 days)</option>
                <option value="XL">XL (Week+)</option>
              </select>
            </div>
          </div>

          {/* Business Value */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-1">
              Business Value (1-10)
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={formData.business_value || ''}
              onChange={(e) => setFormData({ ...formData, business_value: e.target.value ? Number(e.target.value) : undefined })}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)]"
              placeholder="Strategic importance (1-10)"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !formData.title.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? 'Adding...' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}