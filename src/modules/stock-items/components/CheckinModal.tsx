/**
 * CheckinModal - Check in a previously checked-out serial unit
 */

import { useState } from 'react';
import { X, Loader2, AlertCircle, Clock, MapPin, User } from 'lucide-react';

interface CheckoutInfo {
  id: string;
  serial_number: string;
  checked_out_by_name: string;
  project_name?: string;
  job_site_name?: string;
  expected_return_date: string;
  checked_out_at: string;
}

interface CheckinModalProps {
  checkout: CheckoutInfo;
  itemName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckinModal({ checkout, itemName, onClose, onSuccess }: CheckinModalProps) {
  const [conditionNotes, setConditionNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOverdue = new Date(checkout.expected_return_date) < new Date();
  const location = checkout.project_name || checkout.job_site_name || 'Unknown';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/stock/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutId: checkout.id,
          conditionNotes: conditionNotes || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to check in');
      }

      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check in');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Check In Tool</h3>
          <button onClick={onClose} className="p-1 hover:bg-[var(--ff-bg-hover)] rounded">
            <X className="h-5 w-5 text-[var(--ff-text-tertiary)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Checkout info */}
          <div className="space-y-2 p-3 bg-[var(--ff-bg-tertiary)] rounded-lg">
            <div>
              <p className="text-xs text-[var(--ff-text-tertiary)]">Item</p>
              <p className="text-sm font-medium text-[var(--ff-text-primary)]">{itemName}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--ff-text-tertiary)]">Serial</p>
              <p className="text-sm text-[var(--ff-text-primary)]">{checkout.serial_number}</p>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-[var(--ff-text-tertiary)] flex items-center gap-1">
                  <User className="h-3 w-3" /> Checked out by
                </p>
                <p className="text-sm text-[var(--ff-text-primary)]">{checkout.checked_out_by_name}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--ff-text-tertiary)] flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Location
                </p>
                <p className="text-sm text-[var(--ff-text-primary)]">{location}</p>
              </div>
            </div>
            <div className="flex gap-4">
              <div>
                <p className="text-xs text-[var(--ff-text-tertiary)] flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Checked out
                </p>
                <p className="text-sm text-[var(--ff-text-primary)]">
                  {new Date(checkout.checked_out_at).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-[var(--ff-text-tertiary)]">Expected return</p>
                <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : 'text-[var(--ff-text-primary)]'}`}>
                  {new Date(checkout.expected_return_date).toLocaleDateString()}
                  {isOverdue && ' (OVERDUE)'}
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Condition notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-secondary)] mb-1">
              Condition Notes (optional)
            </label>
            <textarea
              value={conditionNotes}
              onChange={(e) => setConditionNotes(e.target.value)}
              rows={3}
              placeholder="Any damage, wear, or notes about the tool's condition..."
              className="w-full px-3 py-2 border border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
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
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Check In
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
