/**
 * MovementReversalModal — Modal for reversing a stock movement.
 * Shows original movement summary, requires mandatory reason (min 10 chars).
 */

import { useState } from 'react';
import { AlertTriangle, RotateCcw, Loader2, X } from 'lucide-react';
import { log } from '@/lib/logger';
import { Button } from '@/components/ui/button';

interface MovementSummary {
  id: string;
  referenceNumber: string;
  movementType: string;
  fromLocation: string;
  toLocation: string;
  status: string;
  movementDate: string;
}

interface MovementReversalModalProps {
  movement: MovementSummary;
  onClose: () => void;
  onSuccess: () => void;
}

export function MovementReversalModal({ movement, onClose, onSuccess }: MovementReversalModalProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = reason.trim().length >= 10 && !loading;

  const handleReverse = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/procurement/field-stock/movements/${movement.id}/reverse`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'Failed to reverse movement');
      }

      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reverse movement';
      setError(message);
      log.error('Movement reversal failed', { data: err }, 'MovementReversalModal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-red-500" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              Reverse Movement
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-900/20">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-500" />
            <div className="text-sm text-orange-800 dark:text-orange-200">
              <p className="font-medium">This action cannot be undone</p>
              <p>Reversing this movement will create an inverse movement, revert stock quantities, and update serial statuses.</p>
            </div>
          </div>

          {/* Movement Summary */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
            <h3 className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Original Movement</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Reference:</span>{' '}
                <span className="font-medium text-gray-800 dark:text-gray-200">{movement.referenceNumber}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Type:</span>{' '}
                <span className="font-medium text-gray-800 dark:text-gray-200">{movement.movementType}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">From:</span>{' '}
                <span className="font-medium text-gray-800 dark:text-gray-200">{movement.fromLocation}</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">To:</span>{' '}
                <span className="font-medium text-gray-800 dark:text-gray-200">{movement.toLocation}</span>
              </div>
            </div>
          </div>

          {/* Reason (required) */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Reason for reversal <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Provide a detailed reason (minimum 10 characters)..."
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
            {reason.length > 0 && reason.trim().length < 10 && (
              <p className="mt-1 text-xs text-red-500">
                Reason must be at least 10 characters ({10 - reason.trim().length} more needed)
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleReverse}
            disabled={!canSubmit}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Confirm Reversal
          </Button>
        </div>
      </div>
    </div>
  );
}
