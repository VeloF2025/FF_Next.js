/**
 * OltResolveModal — modal for resolving investigation records
 */

'use client';

import { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

interface OltResolveModalProps {
  recordId: string;
  onClose: () => void;
  onResolved: () => void;
  setError: (e: string | null) => void;
}

export function OltResolveModal({ recordId, onClose, onResolved, setError }: OltResolveModalProps) {
  const [resolutionType, setResolutionType] = useState('');
  const [notes, setNotes] = useState('');
  const [resolving, setResolving] = useState(false);

  const handleResolve = async () => {
    if (!resolutionType) {
      setError('Please select a resolution type');
      return;
    }
    setResolving(true);
    try {
      const res = await fetch('/api/system/olt-report/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          action: 'resolve',
          resolutionType,
          notes: notes || undefined,
        }),
      });
      const data = await res.json();
      if (data.success || data.data?.success) {
        onClose();
        onResolved();
      } else {
        setError(typeof data.error === 'string' ? data.error : data.error?.message || 'Resolve failed');
      }
    } catch {
      setError('Resolve failed');
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 w-full max-w-md border border-[var(--ff-border-light)]">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
          Resolve Investigation
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Resolution Type
            </label>
            <select
              value={resolutionType}
              onChange={(e) => setResolutionType(e.target.value)}
              className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
            >
              <option value="">Select resolution...</option>
              <option value="manually_fixed">Manually Fixed in 1Map</option>
              <option value="closed_invalid">Closed - Invalid Record</option>
              <option value="closed_no_data">Closed - Missing Data</option>
              <option value="closed_false_positive">Closed - False Positive</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--ff-text-primary)] mb-2">
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 bg-[var(--ff-bg-primary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)]"
              placeholder="Add any notes about this resolution..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm bg-[var(--ff-bg-tertiary)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]/80"
            >
              Cancel
            </button>
            <button
              onClick={handleResolve}
              disabled={!resolutionType || resolving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {resolving ? <InlineSpinner size="sm" /> : <CheckCircle className="w-4 h-4" />}
              Resolve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
