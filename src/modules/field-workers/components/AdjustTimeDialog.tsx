/**
 * AdjustTimeDialog — admin-initiated time correction.
 *
 * Edits clock-in and/or clock-out for an existing attendance entry.
 * Submits via adjustEntry(); handles 409 stale-lock gracefully.
 *
 * Dialog pattern: fixed-overlay modal, matching ScheduleVisitModal.tsx.
 */

import { useState } from 'react';
import { X, AlertCircle, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  adjustEntry,
  type FieldAttendanceRow,
} from '../api';
import {
  toLocalDatetimeValue,
  fromLocalDatetimeValue,
} from '../timeHelpers';
import { log } from '@/lib/logger';

const REASON_MIN = 10;

interface AdjustTimeDialogProps {
  row: FieldAttendanceRow;
  /** Called after a successful adjustment so the parent can re-fetch. */
  onSuccess: () => void;
  onClose: () => void;
}

export function AdjustTimeDialog({ row, onSuccess, onClose }: AdjustTimeDialogProps) {
  const [clockIn, setClockIn] = useState(() => toLocalDatetimeValue(row.clock_in_at));
  const [clockOut, setClockOut] = useState(() => toLocalDatetimeValue(row.clock_out_at));
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedReason = reason.trim();
  const reasonOk = trimmedReason.length >= REASON_MIN;
  const reasonLeft = Math.max(0, REASON_MIN - trimmedReason.length);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reasonOk) return;

    const adjustedIn = fromLocalDatetimeValue(clockIn);
    const adjustedOut = fromLocalDatetimeValue(clockOut);

    if (!adjustedIn && !adjustedOut) {
      setError('Enter at least one time to adjust.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await adjustEntry({
        entry_id: row.entry_id,
        adjusted_clock_in_at: adjustedIn || null,
        adjusted_clock_out_at: adjustedOut || null,
        reason: trimmedReason,
        adjustment_kind: 'admin_correction',
        entry_updated_at: row.entry_updated_at,
      });
      toast.success('Time correction submitted');
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // HTTP 409 = stale optimistic lock — entry changed since load.
      if (message.includes('409') || message.toLowerCase().includes('conflict')) {
        setError('Entry changed since you loaded — refresh and try again.');
        onSuccess(); // re-fetch parent list
      } else {
        setError(message);
      }
      log.error('[AdjustTimeDialog] submit failed', { entry_id: row.entry_id, error: message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-lg mx-4 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-neutral-100">Adjust Time</h2>
            <span className="text-xs text-neutral-400 ml-1">— {row.staff_name}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {/* Clock-in */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Clock in (SAST)
            </label>
            <input
              type="datetime-local"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Clock-out */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Clock out (SAST)
            </label>
            <input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Reason <span className="text-red-400">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this time being corrected?"
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
            />
            <div className="flex justify-between mt-1 text-xs">
              <span className={reasonOk ? 'text-neutral-500' : 'text-amber-400 font-medium'}>
                {reasonOk ? 'Looks good.' : `${reasonLeft} more char${reasonLeft === 1 ? '' : 's'} needed.`}
              </span>
              <span className="text-neutral-500 tabular-nums">
                {trimmedReason.length} / {REASON_MIN}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm text-neutral-300 border border-neutral-700 rounded-lg hover:bg-neutral-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !reasonOk}
              className="px-4 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Save correction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
