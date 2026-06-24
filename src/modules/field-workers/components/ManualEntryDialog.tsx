/**
 * ManualEntryDialog — create a manual attendance entry for a field worker.
 *
 * Requires: staff_id (preselected), clock_in_at, clock_out_at, notes (≥10 chars).
 * Submits via addManualEntry(); surfaces 409 "week locked" cleanly.
 *
 * Dialog pattern: fixed-overlay modal, matching ScheduleVisitModal.tsx.
 */

import { useState } from 'react';
import { X, AlertCircle, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { addManualEntry, type FieldAttendanceRow } from '../api';
import { fromLocalDatetimeValue } from '../timeHelpers';
import { log } from '@/lib/logger';

const NOTES_MIN = 10;

/** Minimal worker info needed to pre-select the staff field. */
export interface WorkerOption {
  staff_id: string;
  staff_name: string;
}

interface ManualEntryDialogProps {
  /** If provided, pre-selects this worker; selector is read-only. */
  worker?: WorkerOption;
  /** Full list of workers for the selector when `worker` is not provided. */
  workers?: WorkerOption[];
  /** All existing rows — used to derive a sensible set of workers if `workers` omitted. */
  allRows?: FieldAttendanceRow[];
  /** Called after a successful submission so the parent can re-fetch. */
  onSuccess: () => void;
  onClose: () => void;
}

export function ManualEntryDialog({
  worker,
  workers,
  allRows = [],
  onSuccess,
  onClose,
}: ManualEntryDialogProps) {
  // Build worker options from allRows when neither `worker` nor `workers` supplied.
  const workerOptions: WorkerOption[] = (() => {
    if (workers) return workers;
    const seen = new Set<string>();
    return allRows.reduce<WorkerOption[]>((acc, r) => {
      if (!seen.has(r.staff_id)) {
        seen.add(r.staff_id);
        acc.push({ staff_id: r.staff_id, staff_name: r.staff_name });
      }
      return acc;
    }, []);
  })();

  const [selectedStaff, setSelectedStaff] = useState<string>(
    worker?.staff_id ?? workerOptions[0]?.staff_id ?? ''
  );
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedNotes = notes.trim();
  const notesOk = trimmedNotes.length >= NOTES_MIN;
  const notesLeft = Math.max(0, NOTES_MIN - trimmedNotes.length);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!notesOk) return;
    if (!selectedStaff) { setError('Select a worker.'); return; }
    if (!clockIn) { setError('Clock-in time is required.'); return; }
    if (!clockOut) { setError('Clock-out time is required.'); return; }

    const inIso = fromLocalDatetimeValue(clockIn);
    const outIso = fromLocalDatetimeValue(clockOut);
    if (!inIso || !outIso) { setError('Invalid time values.'); return; }
    if (new Date(outIso) <= new Date(inIso)) {
      setError('Clock-out must be after clock-in.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await addManualEntry({
        staff_id: selectedStaff,
        clock_in_at: inIso,
        clock_out_at: outIso,
        notes: trimmedNotes,
      });
      toast.success('Manual entry added');
      onSuccess();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // 409 = the week is locked.
      if (message.includes('409') || message.toLowerCase().includes('lock')) {
        setError('This week is locked and cannot accept new entries.');
      } else {
        setError(message);
      }
      log.error('[ManualEntryDialog] submit failed', { staff_id: selectedStaff, error: message });
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
            <Plus className="h-5 w-5 text-emerald-400" />
            <h2 className="text-base font-semibold text-neutral-100">Add Manual Entry</h2>
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

          {/* Worker */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Worker <span className="text-red-400">*</span>
            </label>
            {worker ? (
              <div className="px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100">
                {worker.staff_name}
              </div>
            ) : (
              <select
                value={selectedStaff}
                onChange={(e) => setSelectedStaff(e.target.value)}
                required
                className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Select worker…</option>
                {workerOptions.map((w) => (
                  <option key={w.staff_id} value={w.staff_id}>
                    {w.staff_name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Clock-in */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Clock in (SAST) <span className="text-red-400">*</span>
            </label>
            <input
              type="datetime-local"
              value={clockIn}
              onChange={(e) => setClockIn(e.target.value)}
              required
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Clock-out */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Clock out (SAST) <span className="text-red-400">*</span>
            </label>
            <input
              type="datetime-local"
              value={clockOut}
              onChange={(e) => setClockOut(e.target.value)}
              required
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1">
              Notes <span className="text-red-400">*</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Reason for manual entry (min 10 characters)"
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
            />
            <div className="flex justify-between mt-1 text-xs">
              <span className={notesOk ? 'text-neutral-500' : 'text-amber-400 font-medium'}>
                {notesOk ? 'Looks good.' : `${notesLeft} more char${notesLeft === 1 ? '' : 's'} needed.`}
              </span>
              <span className="text-neutral-500 tabular-nums">
                {trimmedNotes.length} / {NOTES_MIN}
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
              disabled={submitting || !notesOk}
              className="px-4 py-2 text-sm bg-emerald-700 text-white rounded-lg hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Add entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
