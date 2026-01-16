/**
 * Budget Adjustment Modal Component
 * PRD-057: Project Budget Tracking System
 *
 * Modal for admin users to adjust budget with required reason
 */

import React, { useState, useEffect } from 'react';
import { X, AlertCircle } from 'lucide-react';
import type { AdjustmentType } from '@/types/budget';

interface BudgetAdjustmentModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AdjustmentData) => Promise<void>;
  currentBudget: number;
  currency?: string;
}

interface AdjustmentData {
  adjustmentType: AdjustmentType;
  amount: number;
  reason: string;
}

const formatCurrency = (amount: number, currency = 'ZAR'): string => {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

export function BudgetAdjustmentModal({
  open,
  onClose,
  onSubmit,
  currentBudget,
  currency = 'ZAR',
}: BudgetAdjustmentModalProps) {
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('increase');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setAdjustmentType('increase');
      setAmount('');
      setReason('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError('Please enter a valid amount greater than 0');
      return;
    }

    if (!reason.trim()) {
      setError('Please provide a reason for this adjustment');
      return;
    }

    if (reason.trim().length < 10) {
      setError('Reason must be at least 10 characters');
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        adjustmentType,
        amount: amountNum,
        reason: reason.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust budget');
    } finally {
      setLoading(false);
    }
  };

  const newBudget =
    adjustmentType === 'increase'
      ? currentBudget + (parseFloat(amount) || 0)
      : currentBudget - (parseFloat(amount) || 0);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Adjust Budget</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Make a budget adjustment. All adjustments are logged for audit purposes.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            {/* Current Budget Display */}
            <div className="p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <p className="text-sm text-gray-500 dark:text-gray-400">Current Budget</p>
              <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(currentBudget, currency)}</p>
            </div>

            {/* Adjustment Type */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Adjustment Type
              </label>
              <div className="flex gap-4">
                {(['increase', 'decrease', 'reallocation'] as AdjustmentType[]).map((type) => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="adjustmentType"
                      value={type}
                      checked={adjustmentType === type}
                      onChange={(e) => setAdjustmentType(e.target.value as AdjustmentType)}
                      className="w-4 h-4 text-blue-600 border-gray-300 dark:border-gray-600 focus:ring-blue-500"
                    />
                    <span className="text-sm capitalize text-gray-700 dark:text-gray-300">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Amount ({currency})
              </label>
              <input
                id="amount"
                name="amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Enter amount"
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* New Budget Preview */}
            {amount && parseFloat(amount) > 0 && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/30 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">New Budget (after adjustment)</p>
                <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
                  {formatCurrency(newBudget, currency)}
                </p>
              </div>
            )}

            {/* Reason */}
            <div className="space-y-2">
              <label htmlFor="reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Reason (required)
              </label>
              <textarea
                id="reason"
                name="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Provide a detailed reason for this adjustment..."
                rows={3}
                required
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Minimum 10 characters. This will be logged for audit purposes.
              </p>
            </div>

            {/* Error Display */}
            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 rounded-b-lg">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Applying...' : 'Apply Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BudgetAdjustmentModal;
