/**
 * CheckinModal - Check in a previously checked-out serial unit
 *
 * Supports condition photos at check-in to document the returned state.
 */

import { useState } from 'react';
import { X, AlertCircle, Clock, MapPin, User } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';
import { ConditionPhotoCapture, type CapturedPhoto } from '@/modules/assets/components/ConditionPhotoCapture';

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
  const [conditionPhotos, setConditionPhotos] = useState<CapturedPhoto[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOverdue = new Date(checkout.expected_return_date) < new Date();
  const location = checkout.project_name || checkout.job_site_name || 'Unknown';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (conditionPhotos.some(p => p.uploading)) {
      setError('Please wait for photos to finish uploading');
      return;
    }

    setIsSubmitting(true);

    const photoUrls = conditionPhotos
      .map(p => p.storageUrl)
      .filter((url): url is string => !!url);

    try {
      const res = await fetch('/api/stock/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkoutId: checkout.id,
          conditionNotes: conditionNotes || null,
          conditionPhotoUrls: photoUrls.length > 0 ? photoUrls : undefined,
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
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] w-full max-w-md max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ff-border-light)]">
          <h3 className="text-lg font-semibold text-[var(--ff-text-primary)]">Check In Tool</h3>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
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

          {/* Condition Photos */}
          <ConditionPhotoCapture
            photos={conditionPhotos}
            onChange={setConditionPhotos}
            storageCategory="checkin-photos"
            maxPhotos={4}
            label="Condition at Return"
            helperText="Photograph the equipment's condition when returned"
          />

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
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              disabled={isSubmitting || conditionPhotos.some(p => p.uploading)}
            >
              {isSubmitting && <InlineSpinner size="sm" />}
              Check In
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
