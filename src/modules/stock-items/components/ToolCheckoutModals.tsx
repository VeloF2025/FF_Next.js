'use client';

import { useState } from 'react';
import { X, AlertCircle, LogOut, LogIn } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { useToolCheckoutMutations } from '../hooks/useToolCheckouts';
import type { StockItem, ToolCheckout } from '@/types/stockItem.types';

interface CheckOutModalProps {
  item: StockItem;
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckOutModal({ item, onClose, onSuccess }: CheckOutModalProps) {
  const { checkOut, isSubmitting, error, clearError } = useToolCheckoutMutations();
  const [jobSiteName, setJobSiteName] = useState('');
  const [expectedReturnDate, setExpectedReturnDate] = useState('');

  // Default to 7 days from now
  const minDate = new Date().toISOString().split('T')[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const result = await checkOut({
      stockItemId: item.id,
      jobSiteName,
      expectedReturnDate,
    });

    if (result) {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <LogOut className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Check Out Tool
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {item.itemCode}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg text-[var(--ff-text-tertiary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Item Info */}
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <p className="text-sm font-medium text-[var(--ff-text-primary)]">{item.name}</p>
            <p className="text-xs text-[var(--ff-text-secondary)] mt-1">
              Serial: {item.serialNumber || 'No serial number'}
            </p>
          </div>

          {/* Job Site */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Job Site / Location *
            </label>
            <input
              type="text"
              value={jobSiteName}
              onChange={(e) => setJobSiteName(e.target.value)}
              required
              placeholder="e.g., Waterfall Estate Phase 3"
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Expected Return Date */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Expected Return Date *
            </label>
            <input
              type="date"
              value={expectedReturnDate}
              onChange={(e) => setExpectedReturnDate(e.target.value)}
              required
              min={minDate}
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting && <InlineSpinner size="sm" />}
              Check Out
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CheckInModalProps {
  checkout: ToolCheckout;
  itemName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckInModal({ checkout, itemName, onClose, onSuccess }: CheckInModalProps) {
  const { checkIn, isSubmitting, error, clearError } = useToolCheckoutMutations();
  const [conditionNotes, setConditionNotes] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    const result = await checkIn({
      checkoutId: checkout.id,
      conditionNotes: conditionNotes || undefined,
    });

    if (result) {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--ff-border-light)]">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <LogIn className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                Check In Tool
              </h2>
              <p className="text-sm text-[var(--ff-text-secondary)]">
                {itemName}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--ff-bg-hover)] rounded-lg text-[var(--ff-text-tertiary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Checkout Info */}
          <div className="p-3 bg-[var(--ff-bg-tertiary)] rounded-lg space-y-1">
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Checked out by: <span className="text-[var(--ff-text-primary)]">{checkout.checkedOutByName || 'Unknown'}</span>
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Location: <span className="text-[var(--ff-text-primary)]">{checkout.jobSiteName || 'N/A'}</span>
            </p>
            <p className="text-sm text-[var(--ff-text-secondary)]">
              Due: <span className="text-[var(--ff-text-primary)]">{checkout.expectedReturnDate}</span>
            </p>
          </div>

          {/* Condition Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Condition Notes (optional)
            </label>
            <textarea
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              rows={3}
              placeholder="Any notes about the condition of the item..."
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] placeholder:text-[var(--ff-text-tertiary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting && <InlineSpinner size="sm" />}
              Check In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
